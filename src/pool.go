package main

import (
	"errors"
	"net"
	"sync"
	"time"
)

// WS session pool for the direct DC path. Keeps up to cfg.poolSize ready
// (TLS + WS-upgraded) sockets per DC/media key so a new Telegram connection
// skips the handshake entirely. Mirrors proxy/pool.py (_WsPool), with two
// Android-specific additions:
//
//   - idle suspension: a key that hasn't been used for poolIdleSuspend stops
//     refilling/rotating, so an unused proxy doesn't reconnect sockets every
//     two minutes and burn mobile data and battery;
//   - a single synchronous direct attempt on a pool miss (unless the key is in
//     refill backoff), so a cold or resumed key doesn't drop to the CF fallback
//     while the pool is still warming up.
//
// Refill failures back off exponentially per key; while a key is backing off
// the direct path is skipped and connections go straight to the fallbacks.

const (
	poolMaxAge          = 120 * time.Second
	poolCheckInterval   = 5 * time.Second
	poolBackoffInitial  = time.Second
	poolBackoffMax      = 30 * time.Minute // upstream: 1h; shorter so direct recovers faster after a network switch
	poolIdleSuspend     = 10 * time.Minute
	poolConnectTimeout  = 8 * time.Second
	poolFrontingTimeout = 7 * time.Second
	poolMissTimeout     = 5 * time.Second
	frontingSNI         = "sprinthost.ru"
)

type poolKey struct {
	dc    int
	media bool
}

type pooledWS struct {
	ws      *rawWebSocket
	created time.Time
}

type wsPool struct {
	mu           sync.Mutex
	idle         map[poolKey][]pooledWS
	refilling    map[poolKey]bool
	rotating     map[poolKey]bool
	failures     map[poolKey]int
	refillAfter  map[poolKey]time.Time
	lastUsed     map[poolKey]time.Time
	frontingPref bool // try SNI fronting first (set after a fronted connect succeeds)
}

var pool = &wsPool{
	idle:        map[poolKey][]pooledWS{},
	refilling:   map[poolKey]bool{},
	rotating:    map[poolKey]bool{},
	failures:    map[poolKey]int{},
	refillAfter: map[poolKey]time.Time{},
	lastUsed:    map[poolKey]time.Time{},
}

// get returns a ready WS for the DC, or nil when the direct path is disabled,
// backing off, or unreachable right now.
func (p *wsPool) get(dc int, isMedia bool) *rawWebSocket {
	target, ok := cfg.dcRedirects[dc]
	if !ok || cfg.poolSize <= 0 {
		return nil
	}
	key := poolKey{dc, isMedia}
	now := time.Now()

	p.mu.Lock()
	p.lastUsed[key] = now
	var stale []*rawWebSocket
	var hit *rawWebSocket
	bucket := p.idle[key]
	for len(bucket) > 0 {
		e := bucket[0]
		bucket = bucket[1:]
		if p.isStale(e, now) {
			stale = append(stale, e.ws)
			continue
		}
		hit = e.ws
		break
	}
	p.idle[key] = bucket
	backingOff := now.Before(p.refillAfter[key])
	fronting := p.frontingPref
	p.scheduleRefillLocked(key, target)
	p.mu.Unlock()

	for _, ws := range stale {
		go ws.close()
	}
	if hit != nil {
		logDebug("WS pool hit DC%d%s (left=%d)", dc, mediaSuffix(isMedia), len(bucket))
		return hit
	}
	if backingOff {
		return nil
	}

	// Pool miss on a key that isn't known-blocked: one quick direct attempt
	// with the currently preferred mode, so this connection isn't penalised
	// while the background refill warms the pool up.
	domains := wsDomains(dc, isMedia)
	sni := ""
	if fronting {
		sni = frontingSNI
	}
	ws, err := wsConnect(target, domains[0], sni, "/apiws", poolMissTimeout)
	if err != nil {
		logDebug("WS pool miss DC%d%s, direct connect failed: %v", dc, mediaSuffix(isMedia), err)
		return nil
	}
	return ws
}

// isStale reports whether a pooled socket is too old or already closed by the
// peer. The liveness probe peeks with an immediate deadline: a timeout means
// the socket is idle and healthy, EOF/reset means the server dropped it.
func (p *wsPool) isStale(e pooledWS, now time.Time) bool {
	if e.ws.closed || now.Sub(e.created) >= poolMaxAge {
		return true
	}
	e.ws.conn.SetReadDeadline(now.Add(time.Millisecond))
	_, err := e.ws.r.Peek(1)
	e.ws.conn.SetReadDeadline(time.Time{})
	if err == nil {
		return false // data pending (e.g. a ping); recv() handles it
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return false
	}
	return true
}

func (p *wsPool) suspended(key poolKey, now time.Time) bool {
	return now.Sub(p.lastUsed[key]) >= poolIdleSuspend
}

// scheduleRefillLocked starts a background refill (and the key's rotation loop)
// unless one is already running or the key is backing off. Caller holds p.mu.
func (p *wsPool) scheduleRefillLocked(key poolKey, target string) {
	if cfg.poolSize <= 0 {
		return
	}
	if !p.rotating[key] {
		p.rotating[key] = true
		go p.rotate(key, target)
	}
	if p.refilling[key] || time.Now().Before(p.refillAfter[key]) {
		return
	}
	p.refilling[key] = true
	go p.refill(key, target)
}

func (p *wsPool) refill(key poolKey, target string) {
	p.mu.Lock()
	needed := cfg.poolSize - len(p.idle[key])
	fronting := p.frontingPref
	p.mu.Unlock()

	connected := 0
	if needed > 0 {
		domains := wsDomains(key.dc, key.media)
		results := make(chan *rawWebSocket, needed)
		for i := 0; i < needed; i++ {
			go func() { results <- p.connectOne(target, domains, fronting) }()
		}
		for i := 0; i < needed; i++ {
			ws := <-results
			if ws == nil {
				continue
			}
			connected++
			p.mu.Lock()
			if !p.rotating[key] {
				// suspended while we were connecting; don't park an orphan socket
				p.mu.Unlock()
				go ws.close()
				continue
			}
			p.idle[key] = append(p.idle[key], pooledWS{ws: ws, created: time.Now()})
			p.mu.Unlock()
		}
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	p.refilling[key] = false
	if needed <= 0 {
		return
	}
	if connected > 0 {
		if p.failures[key] > 0 {
			logInfo("WS pool DC%d%s direct path recovered", key.dc, mediaSuffix(key.media))
		}
		delete(p.failures, key)
		delete(p.refillAfter, key)
		logDebug("WS pool refilled DC%d%s: %d ready", key.dc, mediaSuffix(key.media), len(p.idle[key]))
		return
	}
	f := p.failures[key] + 1
	p.failures[key] = f
	shift := f - 1
	if shift > 12 {
		shift = 12
	}
	delay := poolBackoffInitial << uint(shift)
	if delay > poolBackoffMax {
		delay = poolBackoffMax
	}
	p.refillAfter[key] = time.Now().Add(delay)
	if f == 1 {
		logInfo("WS pool DC%d%s direct path unavailable -> fallback (retrying with backoff)", key.dc, mediaSuffix(key.media))
	} else {
		logDebug("WS pool refill failed for DC%d%s, retry in %s", key.dc, mediaSuffix(key.media), delay)
	}
}

// connectOne tries every candidate domain, in both plain and SNI-fronted mode
// (preferred mode first), and remembers which mode worked. All attempts dial
// the same IP, so a TCP-level dial failure (IP blocked) ends the round early.
func (p *wsPool) connectOne(target string, domains []string, frontingFirst bool) *rawWebSocket {
	modes := []bool{false, true}
	if frontingFirst {
		modes = []bool{true, false}
	}
	for _, domain := range domains {
		for _, fronted := range modes {
			sni, timeout := "", poolConnectTimeout
			if fronted {
				sni, timeout = frontingSNI, poolFrontingTimeout
			}
			ws, err := wsConnect(target, domain, sni, "/apiws", timeout)
			if err != nil {
				logDebug("WS pool connect %s via %s (fronting=%v): %v", domain, target, fronted, err)
				if isDialError(err) {
					return nil
				}
				continue
			}
			p.mu.Lock()
			changed := p.frontingPref != fronted
			p.frontingPref = fronted
			p.mu.Unlock()
			if changed && fronted {
				logInfo("WS pool: direct SNI blocked, switched to fronting (SNI %s)", frontingSNI)
			}
			return ws
		}
	}
	return nil
}

// rotate drops expired/dead sockets and tops the bucket up, until the key goes
// idle long enough to be suspended (the next get() restarts it).
func (p *wsPool) rotate(key poolKey, target string) {
	for {
		time.Sleep(poolCheckInterval)
		now := time.Now()

		p.mu.Lock()
		var expired []*rawWebSocket
		var ready []pooledWS
		for _, e := range p.idle[key] {
			if p.isStale(e, now) {
				expired = append(expired, e.ws)
			} else {
				ready = append(ready, e)
			}
		}
		p.idle[key] = ready
		if p.suspended(key, now) {
			for _, e := range ready {
				expired = append(expired, e.ws)
			}
			p.idle[key] = nil
			p.rotating[key] = false
			p.mu.Unlock()
			for _, ws := range expired {
				go ws.close()
			}
			logDebug("WS pool DC%d%s idle, suspended", key.dc, mediaSuffix(key.media))
			return
		}
		if len(ready) < cfg.poolSize {
			p.scheduleRefillLocked(key, target)
		}
		p.mu.Unlock()

		for _, ws := range expired {
			go ws.close()
		}
	}
}

// warmup pre-fills the pool for every configured DC at startup.
func (p *wsPool) warmup() {
	if cfg.poolSize <= 0 || len(cfg.dcRedirects) == 0 {
		return
	}
	now := time.Now()
	p.mu.Lock()
	for dc, target := range cfg.dcRedirects {
		for _, media := range []bool{false, true} {
			key := poolKey{dc, media}
			p.lastUsed[key] = now
			p.scheduleRefillLocked(key, target)
		}
	}
	p.mu.Unlock()
	logInfo("WS pool warmup started for %d DC(s)", len(cfg.dcRedirects))
}

func mediaSuffix(isMedia bool) string {
	if isMedia {
		return "m"
	}
	return ""
}

// isDialError reports whether err came from the TCP dial itself (as opposed to
// TLS or the WS upgrade), i.e. the IP is unreachable regardless of SNI/Host.
func isDialError(err error) bool {
	var oe *net.OpError
	return errors.As(err, &oe) && oe.Op == "dial"
}
