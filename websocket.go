package main

import (
	"bufio"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

// wsHandshakeError carries the HTTP status of a failed WS upgrade so the caller
// can distinguish a redirect (Telegram steering us elsewhere) from a hard error.
type wsHandshakeError struct {
	statusCode int
	statusLine string
	location   string
}

func (e *wsHandshakeError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.statusCode, e.statusLine)
}

func (e *wsHandshakeError) isRedirect() bool {
	switch e.statusCode {
	case 301, 302, 303, 307, 308:
		return true
	}
	return false
}

const (
	opBinary = 0x2
	opClose  = 0x8
	opPing   = 0x9
	opPong   = 0xA
)

// rawWebSocket is a minimal RFC6455 client speaking only what the Telegram WS
// bridge needs: masked binary frames out, binary frames in, ping/pong/close
// handling. Mirrors proxy/raw_websocket.py.
type rawWebSocket struct {
	conn   net.Conn
	r      *bufio.Reader
	closed bool
}

// wsConnect dials host:443 over TLS (SNI=sni, cert verification disabled — the
// obfuscated MTProto payload is already encrypted end to end) and performs the
// WebSocket upgrade for the given Host header / path.
func wsConnect(host, domain, sni, path string, timeout time.Duration) (*rawWebSocket, error) {
	if sni == "" {
		sni = domain
	}
	if path == "" {
		path = "/apiws"
	}
	dialTimeout := timeout
	if dialTimeout > 10*time.Second {
		dialTimeout = 10 * time.Second
	}

	dialer := &net.Dialer{Timeout: dialTimeout}
	rawConn, err := dialer.Dial("tcp", net.JoinHostPort(host, "443"))
	if err != nil {
		return nil, err
	}
	if tc, ok := rawConn.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
	}

	tlsConn := tls.Client(rawConn, &tls.Config{
		ServerName:         sni,
		InsecureSkipVerify: true,
	})
	tlsConn.SetDeadline(time.Now().Add(dialTimeout))
	if err := tlsConn.Handshake(); err != nil {
		rawConn.Close()
		return nil, err
	}

	keyRaw := make([]byte, 16)
	rand.Read(keyRaw)
	wsKey := base64.StdEncoding.EncodeToString(keyRaw)

	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + domain + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: " + wsKey + "\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Sec-WebSocket-Protocol: binary\r\n" +
		"\r\n"

	if _, err := tlsConn.Write([]byte(req)); err != nil {
		tlsConn.Close()
		return nil, err
	}

	r := bufio.NewReaderSize(tlsConn, 64*1024)
	var lines []string
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			tlsConn.Close()
			if err == io.EOF && len(lines) == 0 {
				return nil, &wsHandshakeError{statusCode: 0, statusLine: "empty response"}
			}
			return nil, err
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			break
		}
		lines = append(lines, trimmed)
	}

	if len(lines) == 0 {
		tlsConn.Close()
		return nil, &wsHandshakeError{statusCode: 0, statusLine: "empty response"}
	}

	statusCode := 0
	parts := strings.SplitN(lines[0], " ", 3)
	if len(parts) >= 2 {
		if code, err := strconv.Atoi(parts[1]); err == nil {
			statusCode = code
		}
	}

	if statusCode == 101 {
		tlsConn.SetDeadline(time.Time{})
		return &rawWebSocket{conn: tlsConn, r: r}, nil
	}

	location := ""
	for _, hl := range lines[1:] {
		if idx := strings.Index(hl, ":"); idx >= 0 {
			k := strings.ToLower(strings.TrimSpace(hl[:idx]))
			v := strings.TrimSpace(hl[idx+1:])
			if k == "location" {
				location = v
			}
		}
	}
	tlsConn.Close()
	return nil, &wsHandshakeError{statusCode: statusCode, statusLine: lines[0], location: location}
}

func xorMask(data, mask []byte) []byte {
	out := make([]byte, len(data))
	for i := range data {
		out[i] = data[i] ^ mask[i&3]
	}
	return out
}

func buildFrame(opcode byte, data []byte, mask bool) []byte {
	length := len(data)
	fb := byte(0x80) | opcode

	var header []byte
	if !mask {
		switch {
		case length < 126:
			header = []byte{fb, byte(length)}
		case length < 65536:
			header = []byte{fb, 126, byte(length >> 8), byte(length)}
		default:
			header = make([]byte, 10)
			header[0] = fb
			header[1] = 127
			binary.BigEndian.PutUint64(header[2:], uint64(length))
		}
		return append(header, data...)
	}

	maskKey := make([]byte, 4)
	rand.Read(maskKey)
	masked := xorMask(data, maskKey)
	switch {
	case length < 126:
		header = []byte{fb, 0x80 | byte(length)}
	case length < 65536:
		header = []byte{fb, 0x80 | 126, byte(length >> 8), byte(length)}
	default:
		header = make([]byte, 10)
		header[0] = fb
		header[1] = 0x80 | 127
		binary.BigEndian.PutUint64(header[2:], uint64(length))
	}
	frame := append(header, maskKey...)
	return append(frame, masked...)
}

func (ws *rawWebSocket) send(data []byte) error {
	if ws.closed {
		return io.ErrClosedPipe
	}
	_, err := ws.conn.Write(buildFrame(opBinary, data, true))
	return err
}

func (ws *rawWebSocket) sendBatch(parts [][]byte) error {
	if ws.closed {
		return io.ErrClosedPipe
	}
	var buf []byte
	for _, p := range parts {
		buf = append(buf, buildFrame(opBinary, p, true)...)
	}
	_, err := ws.conn.Write(buf)
	return err
}

// recv returns the next binary payload, or nil on close.
func (ws *rawWebSocket) recv() ([]byte, error) {
	for !ws.closed {
		opcode, payload, err := ws.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case opClose:
			ws.closed = true
			echo := []byte{}
			if len(payload) >= 2 {
				echo = payload[:2]
			}
			ws.conn.Write(buildFrame(opClose, echo, true))
			return nil, nil
		case opPing:
			ws.conn.Write(buildFrame(opPong, payload, true))
			continue
		case opPong:
			continue
		case 0x1, 0x2:
			return payload, nil
		default:
			continue
		}
	}
	return nil, nil
}

func (ws *rawWebSocket) readFrame() (byte, []byte, error) {
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(ws.r, hdr); err != nil {
		return 0, nil, err
	}
	opcode := hdr[0] & 0x0F
	length := int(hdr[1] & 0x7F)
	if length == 126 {
		ext := make([]byte, 2)
		if _, err := io.ReadFull(ws.r, ext); err != nil {
			return 0, nil, err
		}
		length = int(binary.BigEndian.Uint16(ext))
	} else if length == 127 {
		ext := make([]byte, 8)
		if _, err := io.ReadFull(ws.r, ext); err != nil {
			return 0, nil, err
		}
		length = int(binary.BigEndian.Uint64(ext))
	}

	masked := hdr[1]&0x80 != 0
	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		if _, err := io.ReadFull(ws.r, maskKey); err != nil {
			return 0, nil, err
		}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(ws.r, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		payload = xorMask(payload, maskKey)
	}
	return opcode, payload, nil
}

func (ws *rawWebSocket) close() {
	if ws.closed {
		ws.conn.Close()
		return
	}
	ws.closed = true
	ws.conn.Write(buildFrame(opClose, nil, true))
	ws.conn.Close()
}
