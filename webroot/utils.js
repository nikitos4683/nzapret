// Pure, state-free helpers shared across the WebUI controller.
// Nothing here reads module-level app state; everything takes its inputs as
// arguments and returns a value (or performs a self-contained DOM action).

const LOG_BOTTOM_THRESHOLD = 40;

export function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

export function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Split text into trimmed, non-empty, non-comment lines.
export function parseLines(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

// Mirrors is_valid_private_dns_hostname in common.sh.
export function isValidHostname(value) {
    const host = String(value || '').trim().toLowerCase();
    if (!host || host.length > 253) return false;
    if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
    if (!/^[a-z0-9.-]+$/.test(host)) return false;

    const labels = host.split('.');
    return labels.length >= 2 && labels.every((label) =>
        label.length <= 63
        && !label.startsWith('-')
        && !label.endsWith('-')
    );
}

export function setButtonDisabled(button, disabled) {
    if (!button) return;
    button.disabled = disabled;
    button.classList.toggle('disabled', disabled);
}

export function waitForPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

export function isPaneNearBottom(pane) {
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight < LOG_BOTTOM_THRESHOLD;
}

// Apply now and again on the next frame, after layout catches up with new content.
function applyScrollTwice(pane, getScrollTop) {
    const apply = () => {
        pane.scrollTop = getScrollTop();
    };
    apply();
    requestAnimationFrame(apply);
}

export function setPaneScrollTop(pane, scrollTop) {
    applyScrollTwice(pane, () => Math.max(0, Math.min(scrollTop, pane.scrollHeight - pane.clientHeight)));
}

export function scrollPaneToBottom(pane) {
    applyScrollTwice(pane, () => pane.scrollHeight);
}

// Replace a pane's text or HTML only when it changed; returns whether it did.
export function updatePaneContent(pane, nextContent, options = {}) {
    const prop = options.html ? 'innerHTML' : 'textContent';
    if (pane[prop] === nextContent) return false;
    pane[prop] = nextContent;
    return true;
}
