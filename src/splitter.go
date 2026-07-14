package main

import "encoding/binary"

// splitter breaks the re-encrypted TCP stream back into individual MTProto
// transport packets so each can be sent as its own WebSocket frame — Telegram's
// WS endpoint expects one packet per frame. It keeps a parallel plaintext
// buffer (decrypted with a fresh telegram-side stream) purely to read the
// packet-length headers while still emitting the ciphertext slices.
//
// Mirrors MsgSplitter in proxy/bridge.py.
type splitter struct {
	dec       *ctrStream
	proto     uint32
	cipherBuf []byte
	plainBuf  []byte
	disabled  bool
}

func newSplitter(relayInit []byte, proto uint32) *splitter {
	d := newCTR(relayInit[skipLen:skipLen+prekeyLen], relayInit[skipLen+prekeyLen:skipLen+prekeyLen+ivLen])
	d.skip(handshakeLen)
	return &splitter{dec: d, proto: proto}
}

func (s *splitter) split(chunk []byte) [][]byte {
	if len(chunk) == 0 {
		return nil
	}
	if s.disabled {
		return [][]byte{chunk}
	}

	s.cipherBuf = append(s.cipherBuf, chunk...)
	s.plainBuf = append(s.plainBuf, s.dec.update(chunk)...)

	var parts [][]byte
	offset := 0
	bufLen := len(s.cipherBuf)
	for offset < bufLen {
		packetLen, ok := s.nextPacketLen(offset, bufLen-offset)
		if !ok {
			break // need more data
		}
		if packetLen <= 0 {
			// Unknown framing: stop parsing and pass the remainder through raw.
			parts = append(parts, append([]byte(nil), s.cipherBuf[offset:]...))
			offset = bufLen
			s.disabled = true
			break
		}
		parts = append(parts, append([]byte(nil), s.cipherBuf[offset:offset+packetLen]...))
		offset += packetLen
	}

	if offset > 0 {
		s.cipherBuf = append([]byte(nil), s.cipherBuf[offset:]...)
		s.plainBuf = append([]byte(nil), s.plainBuf[offset:]...)
	}
	return parts
}

func (s *splitter) flush() []byte {
	if len(s.cipherBuf) == 0 {
		return nil
	}
	tail := s.cipherBuf
	s.cipherBuf = nil
	s.plainBuf = nil
	return tail
}

// nextPacketLen returns (length, ok). ok=false means "need more data".
// length<=0 with ok=true means the framing is unknown and parsing should stop.
func (s *splitter) nextPacketLen(offset, avail int) (int, bool) {
	if avail <= 0 {
		return 0, false
	}
	switch s.proto {
	case protoAbridgedInt:
		return s.nextAbridgedLen(offset, avail)
	case protoIntermediateInt, protoPaddedIntermediateInt:
		return s.nextIntermediateLen(offset, avail)
	default:
		return 0, true
	}
}

func (s *splitter) nextAbridgedLen(offset, avail int) (int, bool) {
	first := s.plainBuf[offset]
	var payloadLen, headerLen int
	if first == 0x7F || first == 0xFF {
		if avail < 4 {
			return 0, false
		}
		b := s.plainBuf[offset+1 : offset+4]
		payloadLen = int(uint32(b[0])|uint32(b[1])<<8|uint32(b[2])<<16) * 4
		headerLen = 4
	} else {
		payloadLen = int(first&0x7F) * 4
		headerLen = 1
	}
	if payloadLen <= 0 {
		return 0, true
	}
	packetLen := headerLen + payloadLen
	if avail < packetLen {
		return 0, false
	}
	return packetLen, true
}

func (s *splitter) nextIntermediateLen(offset, avail int) (int, bool) {
	if avail < 4 {
		return 0, false
	}
	payloadLen := int(binary.LittleEndian.Uint32(s.plainBuf[offset:offset+4]) & 0x7FFFFFFF)
	if payloadLen <= 0 {
		return 0, true
	}
	packetLen := 4 + payloadLen
	if avail < packetLen {
		return 0, false
	}
	return packetLen, true
}
