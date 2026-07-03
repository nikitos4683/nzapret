package main

import (
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// dcDefaultIPs are the direct MTProto endpoints used for the plain-TCP
// fallback when the WebSocket path is unavailable. Mirrors DC_DEFAULT_IPS.
var dcDefaultIPs = map[int]string{
	1:   "149.154.175.50",
	2:   "149.154.167.51",
	3:   "149.154.175.100",
	4:   "149.154.167.91",
	5:   "149.154.171.5",
	203: "91.105.192.100",
}

// wsDomains returns the candidate Telegram WS hostnames for a DC, ordered by
// preference for the media/non-media case. Mirrors ws_domains().
func wsDomains(dc int, isMedia bool) []string {
	if dc == 203 {
		dc = 2
	}
	if isMedia {
		return []string{
			fmt.Sprintf("kws%d-1.web.telegram.org", dc),
			fmt.Sprintf("kws%d.web.telegram.org", dc),
		}
	}
	return []string{
		fmt.Sprintf("kws%d.web.telegram.org", dc),
		fmt.Sprintf("kws%d-1.web.telegram.org", dc),
	}
}

// bridgeWSReencrypt runs the bidirectional client<->WS bridge, re-encrypting in
// both directions and framing the upstream direction via the splitter.
// client ciphertext -> decrypt(clt) -> encrypt(tg) -> WS frames
// WS payload        -> decrypt(tg)  -> encrypt(clt) -> client TCP
func bridgeWSReencrypt(client net.Conn, ws *rawWebSocket, ctx *cryptoCtx, sp *splitter, label string) {
	var once sync.Once
	stop := func() {
		once.Do(func() {
			ws.close()
			client.Close()
		})
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// client -> telegram
	go func() {
		defer wg.Done()
		defer stop()
		buf := make([]byte, 65536)
		for {
			n, err := client.Read(buf)
			if n > 0 {
				enc := ctx.tgEnc.update(ctx.cltDec.update(buf[:n]))
				if sp != nil {
					parts := sp.split(enc)
					if len(parts) == 1 {
						if werr := ws.send(parts[0]); werr != nil {
							return
						}
					} else if len(parts) > 1 {
						if werr := ws.sendBatch(parts); werr != nil {
							return
						}
					}
				} else if werr := ws.send(enc); werr != nil {
					return
				}
			}
			if err != nil {
				if err == io.EOF && sp != nil {
					if tail := sp.flush(); tail != nil {
						ws.send(tail)
					}
				}
				return
			}
		}
	}()

	// telegram -> client
	go func() {
		defer wg.Done()
		defer stop()
		for {
			data, err := ws.recv()
			if err != nil || data == nil {
				return
			}
			out := ctx.cltEnc.update(ctx.tgDec.update(data))
			if _, werr := client.Write(out); werr != nil {
				return
			}
		}
	}()

	wg.Wait()
	stop()
	logDebug("[%s] WS session closed", label)
}

// tcpFallback connects directly to the DC's MTProto endpoint over plain TCP,
// writes the relay init, then bridges with re-encryption (no WS framing).
// Mirrors _tcp_fallback + _bridge_tcp_reencrypt.
func tcpFallback(client net.Conn, relayInit []byte, ctx *cryptoCtx, dc int, label string) bool {
	dst, ok := dcDefaultIPs[dc]
	if !ok {
		return false
	}
	remote, err := net.DialTimeout("tcp", net.JoinHostPort(dst, "443"), 10*time.Second)
	if err != nil {
		logWarn("[%s] TCP fallback to %s:443 failed: %v", label, dst, err)
		return false
	}
	if tc, ok := remote.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
	}
	logInfo("[%s] DC%d -> TCP fallback to %s:443", label, dc, dst)

	if _, err := remote.Write(relayInit); err != nil {
		remote.Close()
		return false
	}

	var once sync.Once
	stop := func() {
		once.Do(func() {
			remote.Close()
			client.Close()
		})
	}
	var wg sync.WaitGroup
	wg.Add(2)

	// client -> telegram
	go func() {
		defer wg.Done()
		defer stop()
		buf := make([]byte, 65536)
		for {
			n, err := client.Read(buf)
			if n > 0 {
				out := ctx.tgEnc.update(ctx.cltDec.update(buf[:n]))
				if _, werr := remote.Write(out); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// telegram -> client
	go func() {
		defer wg.Done()
		defer stop()
		buf := make([]byte, 65536)
		for {
			n, err := remote.Read(buf)
			if n > 0 {
				out := ctx.cltEnc.update(ctx.tgDec.update(buf[:n]))
				if _, werr := client.Write(out); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
	stop()
	return true
}
