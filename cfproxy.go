package main

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	mrand "math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Cloudflare-proxied domain fallback. When Telegram's own IPs are blocked at
// the network level (the common hard-block case), direct WS / direct TCP both
// time out. These domains resolve to Cloudflare, which fronts a worker that
// bridges to Telegram — so the client reaches CF (not blocked) instead of the
// Telegram IP. Mirrors proxy/config.py + proxy/balancer.py + _cfproxy_fallback.

const cfproxyDomainsURL = "https://raw.githubusercontent.com/Flowseal/tg-ws-proxy/main/.github/cfproxy-domains.txt"

// cfEncodedDefaults are the obfuscated fallback domains baked in as a floor when
// the GitHub refresh is unavailable. Decoded via ddDecode at startup.
var cfEncodedDefaults = []string{
	"virkgj.com", "vmmzovy.com", "mkuosckvso.com", "zaewayzmplad.com", "twdmbzcm.com",
	"awzwsldi.com", "clngqrflngqin.com", "tjacxbqtj.com", "bxaxtxmrw.com", "dmohrsgmohcrwb.com",
	"vwbmtmoi.com", "khgrre.com", "ulihssf.com", "tmhqsdqmfpmk.com", "xwuwoqbm.com",
	"orgcnunpj.com", "zhkuldz.com", "zypoljnslxa.com", "efabnxaowuzs.com", "zaftuzsftqdq.com",
}

const cfMinValidDomains = 3

// ddDecode reverses the Caesar-style obfuscation applied to the domain list.
// Encoded entries end in ".com"; the real domain is the shifted stem + ".co.uk".
func ddDecode(s string) string {
	if !strings.HasSuffix(s, ".com") {
		return s
	}
	p := s[:len(s)-4]
	n := 0
	for _, c := range p {
		if isAlpha(c) {
			n++
		}
	}
	var b strings.Builder
	for _, c := range p {
		if isAlpha(c) {
			var base rune = 65
			if c > '`' {
				base = 97
			}
			b.WriteRune((c-base-rune(n)+26*100)%26 + base)
		} else {
			b.WriteRune(c)
		}
	}
	return b.String() + ".co.uk"
}

func isAlpha(c rune) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func decodeDomains(encoded []string) []string {
	out := make([]string, 0, len(encoded))
	for _, e := range encoded {
		out = append(out, ddDecode(e))
	}
	return out
}

// cfBalancer keeps a sticky per-DC domain (so a working route is reused) plus a
// shuffled iteration order over the whole pool for fallback. Mirrors _Balancer.
type cfBalancer struct {
	mu      sync.Mutex
	domains []string
	dcToDom map[int]string
}

var balancer = &cfBalancer{dcToDom: map[int]string{}}

func (b *cfBalancer) updateDomains(list []string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if sameStringSet(b.domains, list) {
		return
	}
	b.domains = append([]string(nil), list...)
	b.dcToDom = map[int]string{}
	for _, dc := range []int{1, 2, 3, 4, 5, 203} {
		b.dcToDom[dc] = list[mrand.Intn(len(list))]
	}
}

func (b *cfBalancer) updateDomainForDC(dc int, dom string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.dcToDom[dc] == dom {
		return false
	}
	b.dcToDom[dc] = dom
	return true
}

func (b *cfBalancer) domainsForDC(dc int) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	cur := b.dcToDom[dc]
	out := make([]string, 0, len(b.domains)+1)
	if cur != "" {
		out = append(out, cur)
	}
	shuf := append([]string(nil), b.domains...)
	mrand.Shuffle(len(shuf), func(i, j int) { shuf[i], shuf[j] = shuf[j], shuf[i] })
	for _, d := range shuf {
		if d != cur {
			out = append(out, d)
		}
	}
	return out
}

func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]int{}
	for _, s := range a {
		m[s]++
	}
	for _, s := range b {
		m[s]--
	}
	for _, v := range m {
		if v != 0 {
			return false
		}
	}
	return true
}

// tryCFFallback connects to kws{dc}.{cfdomain} (fronted by Cloudflare) and
// bridges through it. Returns true if a session was established.
func tryCFFallback(client net.Conn, relayInit []byte, ctx *cryptoCtx, sp *splitter, dc int, label string) bool {
	for _, base := range balancer.domainsForDC(dc) {
		domain := fmt.Sprintf("kws%d.%s", dc, base)
		ws, err := wsConnect(domain, domain, "", "/apiws", 10*time.Second)
		if err != nil {
			logWarn("[%s] DC%d CF proxy %s failed: %v", label, dc, domain, err)
			continue
		}
		if balancer.updateDomainForDC(dc, base) {
			logInfo("[%s] switched active CF domain to %s", label, base)
		}
		logInfo("[%s] DC%d -> CF proxy via %s", label, dc, domain)
		if err := ws.send(relayInit); err != nil {
			ws.close()
			continue
		}
		bridgeWSReencrypt(client, ws, ctx, sp, label)
		return true
	}
	return false
}

// initCFDomains seeds the balancer with the baked-in defaults, then refreshes
// from GitHub in the background (best-effort; defaults stay if it fails).
func initCFDomains() {
	balancer.updateDomains(decodeDomains(cfEncodedDefaults))
	go func() {
		for {
			refreshCFDomains()
			time.Sleep(time.Hour)
		}
	}()
}

func refreshCFDomains() {
	fetched, err := fetchCFDomains()
	if err != nil {
		logDebug("CF domain refresh failed: %v", err)
		return
	}
	pool := normalizeDomains(decodeDomains(fetched))
	if len(pool) >= cfMinValidDomains {
		balancer.updateDomains(pool)
		logInfo("CF proxy domain pool updated from GitHub (%d domains)", len(pool))
	}
}

func fetchCFDomains() ([]string, error) {
	// Resolve GitHub through our public-DNS resolver (Android's stub resolver is
	// unreachable from a static Go binary) and verify TLS against the device's
	// CA store so the fetch stays authenticated.
	transport := &http.Transport{
		DialContext:     (&net.Dialer{Timeout: 10 * time.Second, Resolver: dnsResolver}).DialContext,
		TLSClientConfig: &tls.Config{RootCAs: caCertPool()},
	}
	client := &http.Client{Timeout: 10 * time.Second, Transport: transport}
	req, err := http.NewRequest("GET", cfproxyDomainsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nztgproxy")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}
	var out []string
	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out = append(out, line)
	}
	return out, nil
}

var (
	caPoolOnce sync.Once
	caPool     *x509.CertPool
)

// caCertPool returns a pool built from the device's CA store. A static Go binary
// built for GOOS=linux doesn't know Android's cert locations, so load them
// explicitly. Returns nil on non-Android hosts (falls back to the system pool).
func caCertPool() *x509.CertPool {
	caPoolOnce.Do(func() {
		pool := x509.NewCertPool()
		dirs := []string{
			"/system/etc/security/cacerts",        // classic Android trust store
			"/apex/com.android.conscrypt/cacerts", // Android 14+ (APEX)
			"/data/misc/keychain/cacerts-added",   // user-added CAs
		}
		loaded := 0
		for _, dir := range dirs {
			entries, err := os.ReadDir(dir)
			if err != nil {
				continue
			}
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				data, err := os.ReadFile(filepath.Join(dir, e.Name()))
				if err != nil {
					continue
				}
				if pool.AppendCertsFromPEM(data) {
					loaded++
				}
			}
		}
		if loaded > 0 {
			caPool = pool
		}
	})
	return caPool
}

func normalizeDomains(domains []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, d := range domains {
		d = strings.ToLower(strings.TrimSpace(d))
		if !isValidDomain(d) || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	return out
}

func isValidDomain(domain string) bool {
	if domain == "" || len(domain) > 253 {
		return false
	}
	if strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 {
			return false
		}
		if label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, ch := range label {
			if !(ch >= 'a' && ch <= 'z') && !(ch >= '0' && ch <= '9') && ch != '-' {
				return false
			}
		}
	}
	tld := labels[len(labels)-1]
	if len(tld) < 2 {
		return false
	}
	hasAlpha := false
	for _, ch := range tld {
		if ch >= 'a' && ch <= 'z' {
			hasAlpha = true
		}
	}
	return hasAlpha
}
