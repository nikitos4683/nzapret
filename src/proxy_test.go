package main

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"testing"
)

// buildClientInit mirrors how a Telegram client (or generateRelayInit) crafts an
// obfuscated MTProto preamble, but keys the cipher with the proxy secret the way
// a dd-secret client does. Used to drive tryHandshake in tests.
func buildClientInit(protoTag []byte, dcIdx int16, secret []byte) []byte {
	rnd := make([]byte, handshakeLen)
	for {
		rand.Read(rnd)
		if rnd[0] == 0xEF {
			continue
		}
		if reservedStartMatch(rnd[:4]) {
			continue
		}
		if bytes.Equal(rnd[4:8], reservedContinue) {
			continue
		}
		break
	}
	key := sha256sum(rnd[skipLen:skipLen+prekeyLen], secret)
	iv := rnd[skipLen+prekeyLen : skipLen+prekeyLen+ivLen]
	enc := newCTR(key, iv)

	tailPlain := make([]byte, 8)
	copy(tailPlain[0:4], protoTag)
	binary.LittleEndian.PutUint16(tailPlain[4:6], uint16(dcIdx))

	encFull := enc.update(rnd)
	encTail := make([]byte, 8)
	for i := 0; i < 8; i++ {
		ks := encFull[56+i] ^ rnd[56+i]
		encTail[i] = tailPlain[i] ^ ks
	}
	out := append([]byte(nil), rnd...)
	copy(out[protoTagPos:handshakeLen], encTail)
	return out
}

func TestHandshakeRoundTrip(t *testing.T) {
	secret := make([]byte, 16)
	rand.Read(secret)

	cases := []struct {
		tag     []byte
		dc      int
		isMedia bool
	}{
		{protoTagAbridged, 2, false},
		{protoTagIntermediate, 4, true},
		{protoTagSecure, 5, false},
		{protoTagIntermediate, 1, true},
	}

	for _, c := range cases {
		dcIdx := int16(c.dc)
		if c.isMedia {
			dcIdx = int16(-c.dc)
		}
		init := buildClientInit(c.tag, dcIdx, secret)
		dc, isMedia, tag, prekeyIV, ok := tryHandshake(init, secret)
		if !ok {
			t.Fatalf("handshake failed for dc=%d media=%v", c.dc, c.isMedia)
		}
		if dc != c.dc || isMedia != c.isMedia {
			t.Fatalf("got dc=%d media=%v, want dc=%d media=%v", dc, isMedia, c.dc, c.isMedia)
		}
		if !bytes.Equal(tag, c.tag) {
			t.Fatalf("proto tag mismatch: got %x want %x", tag, c.tag)
		}
		if len(prekeyIV) != prekeyLen+ivLen {
			t.Fatalf("prekeyIV wrong length: %d", len(prekeyIV))
		}
	}
}

func TestHandshakeWrongSecret(t *testing.T) {
	secret := make([]byte, 16)
	rand.Read(secret)
	wrong := make([]byte, 16)
	rand.Read(wrong)

	init := buildClientInit(protoTagAbridged, 2, secret)
	if _, _, _, _, ok := tryHandshake(init, wrong); ok {
		t.Fatal("handshake unexpectedly succeeded with wrong secret")
	}
}

func TestGenerateRelayInitConstraints(t *testing.T) {
	for i := 0; i < 2000; i++ {
		init := generateRelayInit(protoTagIntermediate, 2)
		if len(init) != handshakeLen {
			t.Fatalf("relay init wrong length: %d", len(init))
		}
		if init[0] == 0xEF {
			t.Fatal("relay init starts with reserved 0xEF")
		}
		if reservedStartMatch(init[:4]) {
			t.Fatalf("relay init has reserved start: %x", init[:4])
		}
		if bytes.Equal(init[4:8], reservedContinue) {
			t.Fatal("relay init has reserved continue")
		}
	}
}

func TestSplitterIntermediate(t *testing.T) {
	relayInit := generateRelayInit(protoTagIntermediate, 2)

	// A fresh telegram-side encrypt stream produces the ciphertext the splitter
	// will consume (same key/iv/skip as the splitter's internal decryptor).
	enc := newCTR(relayInit[skipLen:skipLen+prekeyLen], relayInit[skipLen+prekeyLen:skipLen+prekeyLen+ivLen])
	enc.skip(handshakeLen)

	mkPacket := func(payloadLen int) []byte {
		pkt := make([]byte, 4+payloadLen)
		binary.LittleEndian.PutUint32(pkt[:4], uint32(payloadLen))
		rand.Read(pkt[4:])
		return pkt
	}
	pkt1 := mkPacket(8)
	pkt2 := mkPacket(20)
	plain := append(append([]byte(nil), pkt1...), pkt2...)
	cipher := enc.update(plain)

	sp := newSplitter(relayInit, protoIntermediateInt)

	// Feed in two arbitrary chunks to exercise the buffering across boundaries.
	var parts [][]byte
	parts = append(parts, sp.split(cipher[:5])...)
	parts = append(parts, sp.split(cipher[5:])...)

	if len(parts) != 2 {
		t.Fatalf("expected 2 packets, got %d", len(parts))
	}
	if len(parts[0]) != len(pkt1) || len(parts[1]) != len(pkt2) {
		t.Fatalf("packet lengths: got %d,%d want %d,%d",
			len(parts[0]), len(parts[1]), len(pkt1), len(pkt2))
	}

	// Concatenated ciphertext parts must equal the original ciphertext.
	joined := append(append([]byte(nil), parts[0]...), parts[1]...)
	if !bytes.Equal(joined, cipher) {
		t.Fatal("reassembled ciphertext does not match input")
	}
}
