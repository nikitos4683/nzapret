// nztgproxy — a minimal Go port of the tg-ws-proxy MTProto->WebSocket bridge,
// built as a static (CGO-free) binary for on-device use in the nzapret Android
// module. It exposes a local MTProto proxy that Telegram connects to and bridges
// traffic to Telegram DCs over WSS, with a direct-TCP fallback.
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type config struct {
	host          string
	port          int
	secret        []byte // 16 bytes
	dcRedirects   map[int]string
	fallbackCF    bool
	cfUserDomains []string
	linkFile      string
	verbose       bool
}

var cfg config

var (
	logMu   sync.Mutex
	verbose bool
)

func logInfo(format string, a ...interface{}) { logLine("INFO ", format, a...) }
func logWarn(format string, a ...interface{}) { logLine("WARN ", format, a...) }
func logDebug(format string, a ...interface{}) {
	if verbose {
		logLine("DEBUG", format, a...)
	}
}

func logLine(level, format string, a ...interface{}) {
	logMu.Lock()
	defer logMu.Unlock()
	log.Printf("%s %s", level, fmt.Sprintf(format, a...))
}

func main() {
	// Subcommands used by the module CLI (before flag parsing).
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "gensecret":
			fmt.Println(hex.EncodeToString(randomSecret()))
			return
		case "cftest":
			runCFTest(os.Args[2:])
			return
		}
	}

	var (
		host       = flag.String("host", "127.0.0.1", "listen host")
		port       = flag.Int("port", 1443, "listen port")
		secretHex  = flag.String("secret", "", "MTProto secret (32 hex chars); random if empty")
		secretFile = flag.String("secret-file", "", "read/persist the secret at this path")
		dcIP       arrayFlags
		cfDomain   arrayFlags
		noCF       = flag.Bool("no-cfproxy", false, "disable the Cloudflare proxy fallback")
		linkFile   = flag.String("link-file", "", "write the tg:// proxy link to this path")
		verboseF   = flag.Bool("verbose", false, "debug logging")
	)
	flag.Var(&dcIP, "dc-ip", "target IP for a DC, e.g. 2:149.154.167.220 (repeatable)")
	flag.Var(&cfDomain, "cfproxy-domain", "custom Cloudflare-proxied domain for WS fallback (repeatable)")
	flag.Parse()

	log.SetFlags(log.Ltime)
	verbose = *verboseF

	secret, err := resolveSecret(*secretHex, *secretFile)
	if err != nil {
		log.Fatalf("secret: %v", err)
	}

	if len(dcIP) == 0 {
		dcIP = arrayFlags{"2:149.154.167.220", "4:149.154.167.220"}
	}
	dcRedirects, err := parseDCIPList(dcIP)
	if err != nil {
		log.Fatalf("dc-ip: %v", err)
	}

	cfg = config{
		host:          *host,
		port:          *port,
		secret:        secret,
		dcRedirects:   dcRedirects,
		fallbackCF:    !*noCF,
		cfUserDomains: coerceDomains(cfDomain),
		linkFile:      *linkFile,
		verbose:       verbose,
	}

	link := ddLink(cfg.host, cfg.port, cfg.secret)
	if cfg.linkFile != "" {
		if err := os.WriteFile(cfg.linkFile, []byte(link+"\n"), 0644); err != nil {
			logWarn("could not write link file: %v", err)
		}
	}

	if err := serve(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func serve() error {
	addr := net.JoinHostPort(cfg.host, strconv.Itoa(cfg.port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	logInfo("============================================================")
	logInfo("  Telegram MTProto WS Bridge Proxy (nztgproxy)")
	logInfo("  Listening on   %s", addr)
	logInfo("  Secret:        %s", hex.EncodeToString(cfg.secret))
	logInfo("  Target DC IPs:")
	dcs := make([]int, 0, len(cfg.dcRedirects))
	for dc := range cfg.dcRedirects {
		dcs = append(dcs, dc)
	}
	sort.Ints(dcs)
	for _, dc := range dcs {
		logInfo("    DC%d: %s", dc, cfg.dcRedirects[dc])
	}
	logInfo("  Connect: %s", ddLink(cfg.host, cfg.port, cfg.secret))
	logInfo("============================================================")

	if cfg.fallbackCF {
		initCFDomains()
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			return err
		}
		go handleClient(conn)
	}
}

func handleClient(client net.Conn) {
	defer client.Close()
	if tc, ok := client.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
	}
	label := "?"
	if a := client.RemoteAddr(); a != nil {
		label = a.String()
	}

	client.SetReadDeadline(time.Now().Add(10 * time.Second))
	handshake := make([]byte, handshakeLen)
	if _, err := io.ReadFull(client, handshake); err != nil {
		logDebug("[%s] client disconnected before handshake", label)
		return
	}
	client.SetReadDeadline(time.Time{})

	dc, isMedia, protoTag, prekeyIV, ok := tryHandshake(handshake, cfg.secret)
	if !ok {
		logDebug("[%s] bad handshake (wrong secret or proto)", label)
		drain(client)
		return
	}
	mediaTag := ""
	if isMedia {
		mediaTag = " media"
	}

	protoInt := protoTagToInt(protoTag)
	dcIdx := int16(dc)
	if isMedia {
		dcIdx = int16(-dc)
	}
	relayInit := generateRelayInit(protoTag, dcIdx)
	ctx := buildCryptoCtx(prekeyIV, cfg.secret, relayInit)

	target, inConfig := cfg.dcRedirects[dc]
	sp := newSplitter(relayInit, protoInt)

	// Skip the direct-to-Telegram-IP path when the DC has no configured IP, or
	// when that IP recently timed out (network-level block) — go straight to CF.
	skipDirect := !inConfig || ipFailActive(target)

	if !skipDirect {
		var ws *rawWebSocket
		for _, domain := range wsDomains(dc, isMedia) {
			logDebug("[%s] DC%d%s -> wss://%s/apiws via %s", label, dc, mediaTag, domain, target)
			w, err := wsConnect(target, domain, "", "/apiws", 5*time.Second)
			if err != nil {
				if he, isHE := err.(*wsHandshakeError); isHE && he.isRedirect() {
					logDebug("[%s] DC%d%s got %d from %s -> %s", label, dc, mediaTag, he.statusCode, domain, he.location)
					continue
				}
				logDebug("[%s] DC%d%s WS connect failed: %v", label, dc, mediaTag, err)
				continue
			}
			ws = w
			break
		}
		if ws != nil {
			clearIPFail(target)
			if err := ws.send(relayInit); err != nil {
				logDebug("[%s] DC%d%s failed to send relay init: %v", label, dc, mediaTag, err)
				ws.close()
				return
			}
			logRoute(dc, "direct WS")
			bridgeWSReencrypt(client, ws, ctx, sp, label)
			return
		}
		markIPFail(target)
		logDebug("[%s] DC%d%s direct WS unavailable -> CF fallback", label, dc, mediaTag)
	}

	if cfg.fallbackCF && tryCFFallback(client, relayInit, ctx, sp, dc, label) {
		return
	}
	if tcpFallback(client, relayInit, ctx, dc, label) {
		return
	}
	logRoute(dc, "unavailable (no route)")
}

// logRoute logs a concise INFO line only when a DC's effective route changes,
// so a busy session doesn't flood the log with per-connection chatter.
var (
	routeMu    sync.Mutex
	routeState = map[int]string{}
)

func logRoute(dc int, desc string) {
	routeMu.Lock()
	changed := routeState[dc] != desc
	if changed {
		routeState[dc] = desc
	}
	routeMu.Unlock()
	if changed {
		logInfo("DC%d route: %s", dc, desc)
	}
}

// IP-fail cooldown: once a DC's direct IP times out we stop retrying it for a
// while and route straight through the CF fallback.
const ipFailCooldown = time.Hour

var (
	failMu      sync.Mutex
	ipFailUntil = map[string]time.Time{}
)

func ipFailActive(target string) bool {
	if target == "" {
		return false
	}
	failMu.Lock()
	defer failMu.Unlock()
	t, ok := ipFailUntil[target]
	return ok && time.Now().Before(t)
}

func markIPFail(target string) {
	if target == "" {
		return
	}
	failMu.Lock()
	defer failMu.Unlock()
	ipFailUntil[target] = time.Now().Add(ipFailCooldown)
}

func clearIPFail(target string) {
	if target == "" {
		return
	}
	failMu.Lock()
	defer failMu.Unlock()
	delete(ipFailUntil, target)
}

func drain(client net.Conn) {
	buf := make([]byte, 4096)
	client.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, err := client.Read(buf); err != nil {
			return
		}
	}
}

// ddLink builds a dd-secret (no Fake TLS) tg:// proxy link.
func ddLink(host string, port int, secret []byte) string {
	return fmt.Sprintf("tg://proxy?server=%s&port=%d&secret=dd%s", host, port, hex.EncodeToString(secret))
}

func resolveSecret(secretHex, secretFile string) ([]byte, error) {
	if secretHex != "" {
		return decodeSecret(secretHex)
	}
	if secretFile != "" {
		if data, err := os.ReadFile(secretFile); err == nil {
			s := strings.TrimSpace(string(data))
			if s != "" {
				return decodeSecret(s)
			}
		}
		secret := randomSecret()
		if err := os.WriteFile(secretFile, []byte(hex.EncodeToString(secret)+"\n"), 0600); err != nil {
			return nil, fmt.Errorf("persist secret: %w", err)
		}
		return secret, nil
	}
	secret := randomSecret()
	logInfo("Generated secret: %s", hex.EncodeToString(secret))
	return secret, nil
}

func decodeSecret(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if len(s) != 32 {
		return nil, fmt.Errorf("secret must be exactly 32 hex characters")
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("secret must be valid hex")
	}
	return b, nil
}

func parseDCIPList(list []string) (map[int]string, error) {
	out := make(map[int]string)
	for _, entry := range list {
		idx := strings.Index(entry, ":")
		if idx < 0 {
			return nil, fmt.Errorf("invalid --dc-ip %q, expected DC:IP", entry)
		}
		dcS, ipS := entry[:idx], entry[idx+1:]
		dc, err := strconv.Atoi(dcS)
		if err != nil {
			return nil, fmt.Errorf("invalid --dc-ip %q", entry)
		}
		if net.ParseIP(ipS) == nil {
			return nil, fmt.Errorf("invalid IP in --dc-ip %q", entry)
		}
		out[dc] = ipS
	}
	return out, nil
}

// coerceDomains splits comma/space/semicolon-separated values and de-dupes,
// mirroring the reference coerce_domain_list.
func coerceDomains(vals []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range vals {
		for _, part := range strings.FieldsFunc(v, func(r rune) bool {
			return r == ',' || r == ';' || r == ' '
		}) {
			p := strings.TrimSpace(part)
			if p == "" {
				continue
			}
			if k := strings.ToLower(p); !seen[k] {
				seen[k] = true
				out = append(out, p)
			}
		}
	}
	return out
}

// runCFTest attempts a real WS upgrade to a CF-proxied domain and reports the
// result. Used by `nzapret tg cf-test` to check the Cloudflare path.
func runCFTest(args []string) {
	fs := flag.NewFlagSet("cftest", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "JSON output")
	domain := fs.String("domain", "", "CF base domain to test (default: built-in pool)")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}

	var candidates []string
	if *domain != "" {
		candidates = coerceDomains([]string{*domain})
	} else {
		candidates = decodeDomains(cfEncodedDefaults)
	}

	ok := false
	okDomain := ""
	errStr := "no domains to test"
	for _, base := range candidates {
		host := "kws2." + base
		ws, err := wsConnect(host, host, "", "/apiws", 10*time.Second)
		if err != nil {
			errStr = err.Error()
			continue
		}
		ws.close()
		ok = true
		okDomain = base
		errStr = ""
		break
	}

	if *jsonOut {
		b, _ := json.Marshal(struct {
			OK     bool   `json:"ok"`
			Domain string `json:"domain"`
			Error  string `json:"error"`
		}{ok, okDomain, errStr})
		fmt.Println(string(b))
	} else if ok {
		fmt.Printf("CF proxy OK via %s\n", okDomain)
	} else {
		fmt.Printf("CF proxy test failed: %s\n", errStr)
	}
	if !ok {
		os.Exit(1)
	}
}

type arrayFlags []string

func (a *arrayFlags) String() string { return strings.Join(*a, ",") }
func (a *arrayFlags) Set(v string) error {
	*a = append(*a, v)
	return nil
}
