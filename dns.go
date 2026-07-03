package main

import (
	"context"
	"net"
	"time"
)

// Android with CGO disabled has no usable /etc/resolv.conf, so Go's pure-Go
// resolver falls back to [::1]:53 which nothing serves (lookups fail with
// "connection refused"). Resolve names through public DNS servers directly.
//
// Direct-IP dials (Telegram DC IPs, TCP fallback) don't hit this; only the
// Cloudflare fallback needs to resolve kws{dc}.<domain>.
var dnsServers = []string{"1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"}

var dnsResolver = &net.Resolver{
	PreferGo: true,
	Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		var lastErr error
		d := net.Dialer{Timeout: 5 * time.Second}
		for _, srv := range dnsServers {
			conn, err := d.DialContext(ctx, "udp", srv)
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		return nil, lastErr
	},
}
