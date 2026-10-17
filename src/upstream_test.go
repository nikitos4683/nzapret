package main

import (
	"bufio"
	"encoding/binary"
	"net"
	"testing"
	"time"
)

// pipeWS returns a client rawWebSocket and the server end of an in-memory pipe.
func pipeWS() (*rawWebSocket, net.Conn) {
	c, s := net.Pipe()
	return &rawWebSocket{conn: c, r: bufio.NewReader(c)}, s
}

// serverFrame builds an unmasked server->client frame with an explicit FIN bit.
func serverFrame(opcode byte, payload []byte, fin bool) []byte {
	f := buildFrame(opcode, payload, false)
	if !fin {
		f[0] &^= 0x80
	}
	return f
}

func TestWSRecvReassemblesFragments(t *testing.T) {
	ws, srv := pipeWS()
	defer srv.Close()
	go func() {
		srv.Write(serverFrame(opBinary, []byte("hel"), false))
		srv.Write(serverFrame(opPing, []byte("p"), true)) // control frame between fragments
		srv.Write(serverFrame(opCont, []byte("lo "), false))
		srv.Write(serverFrame(opCont, []byte("world"), true))
		srv.Write(serverFrame(opBinary, []byte("next"), true))
	}()
	go func() { // drain the pong the client sends back
		buf := make([]byte, 64)
		srv.Read(buf)
	}()

	got, err := ws.recv()
	if err != nil || string(got) != "hello world" {
		t.Fatalf("reassembled = %q, %v", got, err)
	}
	got, err = ws.recv()
	if err != nil || string(got) != "next" {
		t.Fatalf("next message = %q, %v", got, err)
	}
}

func TestWSReadFrameRejectsOversize(t *testing.T) {
	ws, srv := pipeWS()
	defer srv.Close()
	go func() {
		hdr := make([]byte, 10)
		hdr[0] = 0x80 | opBinary
		hdr[1] = 127
		binary.BigEndian.PutUint64(hdr[2:], maxWSMessageLen+1)
		srv.Write(hdr)
	}()
	if _, err := ws.recv(); err == nil {
		t.Fatal("expected error for oversized frame")
	}
}

func TestReservedStartsIncludeOPTIONS(t *testing.T) {
	if !reservedStartMatch([]byte("OPTI")) {
		t.Fatal("OPTI must be a reserved relay-init start")
	}
}

func TestWSDomains(t *testing.T) {
	if d := wsDomains(2, false); len(d) != 1 || d[0] != "kws2.web.telegram.org" {
		t.Fatalf("non-media domains = %v", d)
	}
	if d := wsDomains(4, true); len(d) != 2 || d[0] != "kws4-1.web.telegram.org" {
		t.Fatalf("media domains = %v", d)
	}
	if d := wsDomains(203, false); d[0] != "kws2.web.telegram.org" {
		t.Fatalf("DC203 domains = %v", d)
	}
}

func TestTCPBackoff(t *testing.T) {
	dst := "192.0.2.1"
	if !tcpDialBegin(dst) {
		t.Fatal("first dial should be allowed")
	}
	if tcpDialBegin(dst) {
		t.Fatal("concurrent dial to the same dst should be skipped")
	}
	if d := tcpDialEnd(dst, false); d != tcpBackoffInitial {
		t.Fatalf("first backoff = %s", d)
	}
	if tcpDialBegin(dst) {
		t.Fatal("dial during backoff should be skipped")
	}
	tcpMu.Lock()
	tcpRetryAfter[dst] = time.Now().Add(-time.Second)
	tcpMu.Unlock()
	if !tcpDialBegin(dst) {
		t.Fatal("dial after backoff expiry should be allowed")
	}
	if d := tcpDialEnd(dst, false); d != 2*tcpBackoffInitial {
		t.Fatalf("second backoff = %s", d)
	}
	for i := 0; i < 20; i++ {
		tcpMu.Lock()
		delete(tcpRetryAfter, dst)
		tcpMu.Unlock()
		tcpDialBegin(dst)
		if d := tcpDialEnd(dst, false); d > tcpBackoffMax {
			t.Fatalf("backoff %s exceeds max", d)
		}
	}
	tcpMu.Lock()
	delete(tcpRetryAfter, dst)
	tcpMu.Unlock()
	tcpDialBegin(dst)
	if d := tcpDialEnd(dst, true); d != 0 {
		t.Fatalf("success should clear backoff, got %s", d)
	}
	if !tcpDialBegin(dst) {
		t.Fatal("dial after success should be allowed")
	}
	tcpDialEnd(dst, true)
}

func TestPoolDisabledWithoutDCOrSize(t *testing.T) {
	saved := cfg
	defer func() { cfg = saved }()

	cfg = config{dcRedirects: map[int]string{}, poolSize: 4}
	if pool.get(2, false) != nil {
		t.Fatal("pool must not serve a DC without a configured IP")
	}
	cfg = config{dcRedirects: map[int]string{2: "192.0.2.1"}, poolSize: 0}
	if pool.get(2, false) != nil {
		t.Fatal("pool size 0 must disable direct WS")
	}
}

func TestPoolStaleDetection(t *testing.T) {
	ws, srv := pipeWS()
	now := time.Now()
	if pool.isStale(pooledWS{ws: ws, created: now}, now) {
		t.Fatal("fresh idle socket reported stale")
	}
	if !pool.isStale(pooledWS{ws: ws, created: now.Add(-poolMaxAge)}, now) {
		t.Fatal("expired socket not reported stale")
	}
	srv.Close()
	if !pool.isStale(pooledWS{ws: ws, created: now}, now) {
		t.Fatal("peer-closed socket not reported stale")
	}
}

func TestIsDialError(t *testing.T) {
	_, err := wsConnect("127.0.0.1", "kws2.web.telegram.org", "", "/apiws", time.Second)
	if err == nil {
		t.Skip("something is listening on 127.0.0.1:443")
	}
	if !isDialError(err) {
		t.Fatalf("refused dial not detected as dial error: %v", err)
	}
	if isDialError(&wsHandshakeError{statusCode: 302}) {
		t.Fatal("handshake error misdetected as dial error")
	}
}
