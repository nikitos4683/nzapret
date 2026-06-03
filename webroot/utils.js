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

export function parseUserListEntries(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

export function toComparableUserListText(value) {
    return Array.isArray(value)
        ? value.join('\n')
        : parseUserListEntries(value).join('\n');
}

export function isValidPrivateDnsHostname(value) {
    const host = String(value || '').trim().toLowerCase();
    if (!host || host.length > 253) return false;
    if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return false;
    if (!/^[a-z0-9.-]+$/.test(host)) return false;

    const labels = host.split('.');
    if (labels.length < 2) return false;
    return labels.every((label) =>
        label.length > 0
        && label.length <= 63
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

function clampPaneScrollTop(pane, scrollTop) {
    return Math.max(0, Math.min(scrollTop, pane.scrollHeight - pane.clientHeight));
}

export function setPaneScrollTop(pane, scrollTop) {
    const applyScroll = () => {
        pane.scrollTop = clampPaneScrollTop(pane, scrollTop);
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
}

export function scrollPaneToBottom(pane) {
    const applyScroll = () => {
        pane.scrollTop = pane.scrollHeight;
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
}

export function updatePaneContent(pane, nextContent, options = {}) {
    const { html = false } = options;
    const currentContent = html ? pane.innerHTML : pane.textContent;

    if (currentContent === nextContent) {
        return false;
    }

    if (html) {
        pane.innerHTML = nextContent;
    } else {
        pane.textContent = nextContent;
    }

    return true;
}
