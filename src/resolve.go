package main

import (
	"sync"
	"time"
)

// Route pre-resolution: probe each configured DC's direct-WS path up front (and
// periodically) so the *first* client connection doesn't have to eat the full
// dial timeout discovering that the direct Telegram IPs are blocked. A blocked
// DC is pre-marked via markIPFail so handleClient skips straight to the CF/TCP
// fallback; a reachable DC is cleared so direct is (re-)enabled after a network
// recovery. This is not a connection pool — probe sockets are closed
// immediately; only the direct-vs-fallback decision is cached.

// routeRefreshInterval re-probes below the ipFailCooldown window so a still
// blocked DC never lapses back to a slow first client, and a recovered network
// re-enables the direct path within one interval.
const routeRefreshInterval = 30 * time.Minute

func routeResolverLoop() {
	preResolveRoutes()
	t := time.NewTicker(routeRefreshInterval)
	defer t.Stop()
	for range t.C {
		preResolveRoutes()
	}
}

// preResolveRoutes probes every configured DC concurrently and returns once all
// probes have settled.
func preResolveRoutes() {
	if len(cfg.dcRedirects) == 0 {
		return
	}
	var wg sync.WaitGroup
	for dc, target := range cfg.dcRedirects {
		wg.Add(1)
		go func(dc int, target string) {
			defer wg.Done()
			probeDirectRoute(dc, target)
		}(dc, target)
	}
	wg.Wait()
}

// probeDirectRoute opens (and immediately closes) a WS to the DC's direct IP to
// learn whether the direct path is usable, then caches the decision.
func probeDirectRoute(dc int, target string) {
	for _, domain := range wsDomains(dc, false) {
		ws, err := wsConnect(target, domain, "", "/apiws", 5*time.Second)
		if err == nil {
			ws.close()
			if ipFailActive(target) {
				logInfo("preresolve: DC%d direct WS recovered via %s", dc, domain)
			} else {
				logDebug("preresolve: DC%d direct WS reachable via %s", dc, domain)
			}
			clearIPFail(target)
			return
		}
		logDebug("preresolve: DC%d probe via %s failed: %v", dc, domain, err)
	}
	if !ipFailActive(target) {
		logInfo("preresolve: DC%d direct WS blocked -> preselecting fallback", dc)
	}
	markIPFail(target)
}
