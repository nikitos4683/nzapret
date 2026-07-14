package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
)

// Protocol constants mirrored from the reference Python implementation
// (proxy/utils.py). The MTProto obfuscated handshake is a fixed 64-byte
// preamble: bytes [8:40] are the AES key material, [40:56] the IV, [56:60]
// the protocol tag and [60:62] the little-endian signed DC index.
const (
	handshakeLen = 64
	skipLen      = 8
	prekeyLen    = 32
	ivLen        = 16
	protoTagPos  = 56
	dcIdxPos     = 60
)

const (
	protoAbridgedInt           uint32 = 0xEFEFEFEF
	protoIntermediateInt       uint32 = 0xEEEEEEEE
	protoPaddedIntermediateInt uint32 = 0xDDDDDDDD
)

var (
	protoTagAbridged     = []byte{0xEF, 0xEF, 0xEF, 0xEF}
	protoTagIntermediate = []byte{0xEE, 0xEE, 0xEE, 0xEE}
	protoTagSecure       = []byte{0xDD, 0xDD, 0xDD, 0xDD}
)

var zero64 = make([]byte, 64)

// reservedStarts / reservedContinue guard the randomly generated relay init so
// it can never look like an HTTP request or another MTProto proto tag on the
// wire — same filtering as _generate_relay_init in the reference.
var reservedStarts = [][]byte{
	[]byte("HEAD"),
	[]byte("POST"),
	[]byte("GET "),
	{0xEE, 0xEE, 0xEE, 0xEE},
	{0xDD, 0xDD, 0xDD, 0xDD},
	{0x16, 0x03, 0x01, 0x02},
}

var reservedContinue = []byte{0x00, 0x00, 0x00, 0x00}

// ctrStream is a thin stateful wrapper over AES-CTR mirroring the
// "encryptor().update()" surface used throughout the Python code. CTR is
// symmetric, so the same primitive serves both encrypt and decrypt directions.
type ctrStream struct {
	s cipher.Stream
}

func newCTR(key, iv []byte) *ctrStream {
	block, err := aes.NewCipher(key)
	if err != nil {
		// key length is always validated by construction (16/32 bytes).
		panic(err)
	}
	return &ctrStream{s: cipher.NewCTR(block, iv)}
}

func (c *ctrStream) update(data []byte) []byte {
	out := make([]byte, len(data))
	c.s.XORKeyStream(out, data)
	return out
}

// skip advances the keystream by n bytes without producing output. Used to
// fast-forward past the 64-byte init block that occupies the first frame.
func (c *ctrStream) skip(n int) {
	buf := make([]byte, n)
	c.s.XORKeyStream(buf, buf)
}

func sha256sum(parts ...[]byte) []byte {
	h := sha256.New()
	for _, p := range parts {
		h.Write(p)
	}
	return h.Sum(nil)
}

func reverse(b []byte) []byte {
	out := make([]byte, len(b))
	for i := range b {
		out[len(b)-1-i] = b[i]
	}
	return out
}

// cryptoCtx holds the four independent AES-CTR streams that bridge the two
// obfuscated MTProto sessions (client<->us and us<->telegram).
type cryptoCtx struct {
	cltDec *ctrStream // decrypt data coming from the client
	cltEnc *ctrStream // encrypt data going to the client
	tgEnc  *ctrStream // encrypt data going to telegram
	tgDec  *ctrStream // decrypt data coming from telegram
}

// tryHandshake decrypts the client preamble and extracts the routing info.
// Returns ok=false if the decrypted proto tag is not a known MTProto tag,
// which means a wrong secret or a non-MTProto client.
func tryHandshake(handshake, secret []byte) (dcID int, isMedia bool, protoTag, prekeyIV []byte, ok bool) {
	prekeyIV = append([]byte(nil), handshake[skipLen:skipLen+prekeyLen+ivLen]...)
	prekey := prekeyIV[:prekeyLen]
	iv := prekeyIV[prekeyLen:]

	key := sha256sum(prekey, secret)
	dec := newCTR(key, iv)
	decrypted := dec.update(handshake)

	protoTag = append([]byte(nil), decrypted[protoTagPos:protoTagPos+4]...)
	if !bytes.Equal(protoTag, protoTagAbridged) &&
		!bytes.Equal(protoTag, protoTagIntermediate) &&
		!bytes.Equal(protoTag, protoTagSecure) {
		return 0, false, nil, nil, false
	}

	dcIdx := int16(binary.LittleEndian.Uint16(decrypted[dcIdxPos : dcIdxPos+2]))
	dcID = int(dcIdx)
	if dcID < 0 {
		dcID = -dcID
		isMedia = true
	}
	return dcID, isMedia, protoTag, prekeyIV, true
}

// protoTagToInt maps a decrypted proto tag to its integer form used by the
// message splitter to pick the transport framing.
func protoTagToInt(tag []byte) uint32 {
	switch {
	case bytes.Equal(tag, protoTagAbridged):
		return protoAbridgedInt
	case bytes.Equal(tag, protoTagIntermediate):
		return protoIntermediateInt
	default:
		return protoPaddedIntermediateInt
	}
}

// buildCryptoCtx derives the four CTR streams. The client-side keys hash the
// secret in (obfuscated MTProto with a proxy secret); the telegram-side keys
// use the raw relay init material (standard obfuscation, no secret). Only the
// encrypt-to-peer streams skip the 64-byte init block, matching the reference.
func buildCryptoCtx(prekeyIV, secret, relayInit []byte) *cryptoCtx {
	cltDecKey := sha256sum(prekeyIV[:prekeyLen], secret)
	cltDecIV := prekeyIV[prekeyLen:]

	rev := reverse(prekeyIV)
	cltEncKey := sha256sum(rev[:prekeyLen], secret)
	cltEncIV := rev[prekeyLen:]

	cltDec := newCTR(cltDecKey, cltDecIV)
	cltDec.skip(handshakeLen)
	cltEnc := newCTR(cltEncKey, cltEncIV)

	relayEncKey := relayInit[skipLen : skipLen+prekeyLen]
	relayEncIV := relayInit[skipLen+prekeyLen : skipLen+prekeyLen+ivLen]

	relayRev := reverse(relayInit[skipLen : skipLen+prekeyLen+ivLen])
	relayDecKey := relayRev[:prekeyLen]
	relayDecIV := relayRev[prekeyLen:]

	tgEnc := newCTR(relayEncKey, relayEncIV)
	tgEnc.skip(handshakeLen)
	tgDec := newCTR(relayDecKey, relayDecIV)

	return &cryptoCtx{cltDec: cltDec, cltEnc: cltEnc, tgEnc: tgEnc, tgDec: tgDec}
}

// generateRelayInit builds the 64-byte obfuscated init we send to Telegram.
// Bytes [0:56] are random (with reserved-pattern filtering); bytes [56:64]
// carry the encrypted proto tag + DC index so the upstream can route us.
func generateRelayInit(protoTag []byte, dcIdx int16) []byte {
	rnd := make([]byte, handshakeLen)
	for {
		if _, err := rand.Read(rnd); err != nil {
			panic(err)
		}
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

	encKey := rnd[skipLen : skipLen+prekeyLen]
	encIV := rnd[skipLen+prekeyLen : skipLen+prekeyLen+ivLen]
	enc := newCTR(encKey, encIV)

	tailRnd := make([]byte, 2)
	if _, err := rand.Read(tailRnd); err != nil {
		panic(err)
	}
	tailPlain := make([]byte, 8)
	copy(tailPlain[0:4], protoTag)
	binary.LittleEndian.PutUint16(tailPlain[4:6], uint16(dcIdx))
	copy(tailPlain[6:8], tailRnd)

	encFull := enc.update(rnd)
	encTail := make([]byte, 8)
	for i := 0; i < 8; i++ {
		keystreamByte := encFull[56+i] ^ rnd[56+i]
		encTail[i] = tailPlain[i] ^ keystreamByte
	}

	result := append([]byte(nil), rnd...)
	copy(result[protoTagPos:handshakeLen], encTail)
	return result
}

func reservedStartMatch(b []byte) bool {
	for _, r := range reservedStarts {
		if bytes.Equal(b, r) {
			return true
		}
	}
	return false
}

func randomSecret() []byte {
	s := make([]byte, 16)
	if _, err := rand.Read(s); err != nil {
		panic(err)
	}
	return s
}
