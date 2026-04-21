import { exec } from './kernelsu.js';
import {
    applyStaticTranslations,
    formatNumber,
    getLocale,
    initializeLocale,
    setLocale as setI18nLocale,
    t,
    tc
} from './i18n.js';

const MODDIR = '/data/adb/modules/nzapret';
const CLI = `sh ${MODDIR}/system/bin/nzapret`;
const LOG_POLL_MS = 3000;
const EVENTS_POLL_MS = 5000;
const LOG_BOTTOM_THRESHOLD = 40;
const PAGE_VIEWS = {
    runtime: {
        pageId: 'pageRuntime',
        buttonId: 'btnPageRuntime'
    },
    tools: {
        pageId: 'pageTools',
        buttonId: 'btnPageTools'
    },
    logs: {
        pageId: 'pageLogs',
        buttonId: 'btnPageLogs'
    }
};
const LOG_VIEWS = {
    runtime: {
        paneId: 'runtimeLogPane',
        tabId: 'btnRuntimeTab'
    },
    events: {
        paneId: 'eventsPane',
        tabId: 'btnEventsTab'
    }
};

initializeLocale();

let isLoading = false;
let logInterval = null;
let eventsInterval = null;
let hasShownStatusError = false;
let statusRequestInFlight = false;
let logRequestInFlight = false;
let eventsRequestInFlight = false;
const logState = {
    runtime: {
        text: '',
        loaded: false,
        scrolledUp: false
    },
    events: {
        items: [],
        lastPayload: '',
        scrolledUp: false
    }
};
let activePage = 'runtime';
let activeLogView = 'runtime';
let currentStatus = null;
let statusViewState = 'checking';
let networkModeDraft = '';
let userListEntries = [];
let userListLoaded = false;
let userListRequestInFlight = false;
let userListSnapshot = '';
let diagnosticsData = null;
let diagnosticsExpanded = false;
let privateDnsInputDirty = false;
const tgLinkState = {
    value: '',
    loaded: false,
    loading: false,
    error: ''
};
let toastTimer = null;
let toastState = null;
let uiLockState = {
    locked: false,
    message: 'common.applying_changes',
    params: {},
    translate: true
};

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function resolveMessage(message, params = {}, translate = true) {
    return translate ? t(message, params) : String(message);
}

function setUiLocked(locked, message = 'common.applying_changes', params = {}, translate = true) {
    uiLockState = { locked, message, params, translate };

    const overlay = document.getElementById('uiLock');
    const text = document.getElementById('uiLockText');
    text.textContent = resolveMessage(message, params, translate);
    overlay.classList.toggle('active', locked);
    document.body.classList.toggle('ui-busy', locked);
}

function rerenderUiLock() {
    if (!uiLockState.locked) return;
    const text = document.getElementById('uiLockText');
    text.textContent = resolveMessage(uiLockState.message, uiLockState.params, uiLockState.translate);
}

function waitForPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

function isPaneNearBottom(pane) {
    return pane.scrollHeight - pane.scrollTop - pane.clientHeight < LOG_BOTTOM_THRESHOLD;
}

function clampPaneScrollTop(pane, scrollTop) {
    return Math.max(0, Math.min(scrollTop, pane.scrollHeight - pane.clientHeight));
}

function setPaneScrollTop(pane, scrollTop) {
    const applyScroll = () => {
        pane.scrollTop = clampPaneScrollTop(pane, scrollTop);
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
}

function scrollPaneToBottom(pane) {
    const applyScroll = () => {
        pane.scrollTop = pane.scrollHeight;
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
}

function getLogViewState(view = activeLogView) {
    return logState[view];
}

function getLogPane(view = activeLogView) {
    return document.getElementById(LOG_VIEWS[view].paneId);
}

function isLogViewScrolledUp(view = activeLogView) {
    const state = getLogViewState(view);
    return Boolean(state && state.scrolledUp);
}

function setLogViewScrolledUp(view, scrolledUp) {
    const state = getLogViewState(view);
    if (!state) return;
    state.scrolledUp = scrolledUp;
}

function updatePaneContent(pane, nextContent, options = {}) {
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

function syncLogPaneScroll(view, pane, previousScrollTop, options = {}) {
    const { forceBottom = false } = options;
    const shouldStickToBottom = forceBottom || isPaneNearBottom(pane) || !isLogViewScrolledUp(view);

    if (shouldStickToBottom) {
        scrollPaneToBottom(pane);
        setLogViewScrolledUp(view, false);
    } else {
        setPaneScrollTop(pane, previousScrollTop);
    }
}

function showToast(message, params = {}, translate = true) {
    const toast = document.getElementById('toast');
    if (toastTimer) {
        clearTimeout(toastTimer);
    }

    toastState = { message, params, translate };
    toast.textContent = resolveMessage(message, params, translate);
    toast.classList.add('show');

    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        toastTimer = null;
        toastState = null;
    }, 2500);
}

function rerenderToast() {
    if (!toastState) return;
    const toast = document.getElementById('toast');
    if (!toast.classList.contains('show')) return;
    toast.textContent = resolveMessage(toastState.message, toastState.params, toastState.translate);
}

function parseUserListEntries(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

function toComparableUserListText(value) {
    return Array.isArray(value)
        ? value.join('\n')
        : parseUserListEntries(value).join('\n');
}

function setButtonDisabled(button, disabled) {
    if (!button) return;
    button.disabled = disabled;
    button.classList.toggle('disabled', disabled);
}

function getSelectedNetworkMode(status = currentStatus) {
    if (networkModeDraft) {
        return networkModeDraft;
    }
    return status && status.network_mode ? status.network_mode : '';
}

function isNetworkModeDirty(status = currentStatus) {
    if (!status || !status.network_mode || !networkModeDraft) {
        return false;
    }
    return networkModeDraft !== status.network_mode;
}

function getPrivateDnsDefaultHostname(status = currentStatus) {
    return status && status.private_dns_default_hostname
        ? status.private_dns_default_hostname
        : 'xbox-dns.ru';
}

function isValidPrivateDnsHostname(value) {
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

function getStaticTranslationParams() {
    return {
        default_hostname: getPrivateDnsDefaultHostname(currentStatus)
    };
}

function updateLocaleButtons() {
    const locale = getLocale();
    document.querySelectorAll('[data-locale]').forEach((button) => {
        button.classList.toggle('active', button.dataset.locale === locale);
    });
}

function getStatusLabel() {
    if (!currentStatus) {
        return statusViewState === 'checking'
            ? t('status.checking')
            : t('status.error');
    }

    const pidCount = parseInt(currentStatus.pid_count || 0, 10);
    if (currentStatus.active && pidCount > 1) {
        return t('status.multi_pid');
    }
    return currentStatus.active
        ? t('status.active')
        : t('status.inactive');
}

function getNetworkModeDisplayLabel(status = currentStatus) {
    if (!status || !status.network_mode) {
        return '--';
    }

    if (status.network_mode === 'ipv4-only') {
        return t('network.mode_ipv4_only');
    }

    return status.ipv6_enabled
        ? t('network.mode_auto_dual')
        : t('network.mode_auto_fallback');
}

function getPrivateDnsStatusCode(status = currentStatus) {
    if (!status) {
        return 'initial';
    }

    if (status.private_dns_available === false) {
        return 'unavailable';
    }

    if (status.private_dns_mode === 'off') {
        return 'off';
    }

    if (status.private_dns_mode === 'hostname') {
        const hostname = status.private_dns_hostname || '';
        const defaultHost = getPrivateDnsDefaultHostname(status);
        if (!hostname) {
            return 'hostname_unspecified';
        }
        return hostname === defaultHost ? 'hostname_default' : 'hostname_custom';
    }

    return 'auto';
}

function getPrivateDnsDisplayLabel(status = currentStatus) {
    if (!status) {
        return '--';
    }

    const code = getPrivateDnsStatusCode(status);
    if (code === 'unavailable') {
        return t('private_dns.unavailable_short');
    }
    if (code === 'off') {
        return t('private_dns.mode_off');
    }
    if (code === 'auto') {
        return t('private_dns.mode_auto');
    }
    if (status.private_dns_hostname) {
        return status.private_dns_hostname;
    }
    return t('private_dns.mode_provider');
}

function getPrivateDnsNote(status = currentStatus) {
    const code = getPrivateDnsStatusCode(status);
    const defaultHost = getPrivateDnsDefaultHostname(status);
    const hostname = status && status.private_dns_hostname ? status.private_dns_hostname : defaultHost;

    switch (code) {
    case 'unavailable':
        return t('private_dns.status_unavailable');
    case 'off':
        return t('private_dns.status_off');
    case 'hostname_default':
        return t('private_dns.status_default_active', { hostname });
    case 'hostname_custom':
        return t('private_dns.status_custom_active', { hostname });
    case 'hostname_unspecified':
        return t('private_dns.status_custom_unspecified');
    case 'auto':
        if (status && status.private_dns_initialized === false) {
            return t('private_dns.status_init_pending', { default_hostname: defaultHost });
        }
        return t('private_dns.status_auto');
    default:
        return t('private_dns.status_initial');
    }
}

function getTgStatus(status = currentStatus) {
    return status && status.tg ? status.tg : null;
}

function getTgRuntime(status = currentStatus) {
    const tg = getTgStatus(status);
    return tg && tg.runtime ? tg.runtime : null;
}

function getTgRuntimeStateLabel(status = currentStatus) {
    const tg = getTgStatus(status);
    const runtime = getTgRuntime(status);

    if (!tg) return '--';
    if (!tg.binary_exists) return t('tg_runtime.missing');
    if (runtime && runtime.active) return t('tg_runtime.running');
    if (runtime && runtime.status === 'error') return t('tg_runtime.error');
    return t('tg_runtime.stopped');
}

function getTgHelperLabel(status = currentStatus) {
    const tg = getTgStatus(status);

    if (!tg) return '--';
    return tg.binary_exists ? t('tg_runtime.helper_builtin') : t('tg_runtime.helper_missing');
}

function getTgListenLabel(status = currentStatus) {
    const runtime = getTgRuntime(status);
    return runtime && runtime.listen ? runtime.listen : '--';
}

function getTgCfLabel(status = currentStatus) {
    const runtime = getTgRuntime(status);
    if (!runtime) {
        return '--';
    }
    if (!runtime.cfproxy) {
        return t('tg_runtime.cf_disabled');
    }

    const priority = runtime.cfproxy_priority
        ? t('tg_runtime.cf_first')
        : t('tg_runtime.tcp_first');
    const domain = runtime.cfproxy_domain || t('tg_runtime.cf_auto');
    return `${priority} · ${domain}`;
}

function extractTelegramProxyLink(output) {
    const match = String(output || '').match(/tg:\/\/proxy\?[^\s]+/);
    return match ? match[0] : '';
}

function getTgLinkValue() {
    if (tgLinkState.value) {
        return tgLinkState.value;
    }
    return t('tg_link.placeholder');
}

function getTgLinkNote(status = currentStatus) {
    const tg = getTgStatus(status);

    if (tgLinkState.loading) {
        return t('tg_link.note_loading');
    }
    if (tg && tg.binary_exists === false) {
        return t('tg_link.note_missing');
    }
    if (tgLinkState.error) {
        return t('tg_link.note_error', { message: tgLinkState.error });
    }
    if (tgLinkState.value) {
        return t('tg_link.note_ready');
    }
    return t('tg_link.note_initial');
}

function renderTgLinkCard(status = currentStatus) {
    const valueNode = document.getElementById('tgLinkValue');
    const noteNode = document.getElementById('tgLinkNote');
    const copyButton = document.getElementById('btnCopyTgLink');
    const reloadButton = document.getElementById('btnReloadTgLink');

    if (!valueNode || !noteNode || !copyButton || !reloadButton) {
        return;
    }

    valueNode.textContent = getTgLinkValue();
    noteNode.textContent = getTgLinkNote(status);
    noteNode.classList.toggle('warning', Boolean(tgLinkState.error) || Boolean(status && status.tg && status.tg.binary_exists === false));

    setButtonDisabled(copyButton, !tgLinkState.value || tgLinkState.loading);
    setButtonDisabled(reloadButton, tgLinkState.loading);
}

async function loadTgLink(force = false, options = {}) {
    const { notify = false } = options;

    if (tgLinkState.loading) {
        return Boolean(tgLinkState.value);
    }
    if (!force && tgLinkState.loaded) {
        return Boolean(tgLinkState.value);
    }

    tgLinkState.loading = true;
    tgLinkState.error = '';
    renderToolsPageUi();

    try {
        const res = await exec(`${CLI} tg link`);
        const stdout = (res.stdout || '').trim();
        const stderr = (res.stderr || '').trim();
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const link = extractTelegramProxyLink(combined);

        if (res.errno !== 0 || !link) {
            throw new Error(combined || 'tg link command failed');
        }

        tgLinkState.value = link;
        tgLinkState.loaded = true;
        tgLinkState.error = '';

        if (notify) {
            showToast('tg_link.reloaded');
        }
        return true;
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        tgLinkState.value = '';
        tgLinkState.loaded = true;
        tgLinkState.error = message;

        if (notify) {
            showToast('tg_link.load_failed', { message });
        }
        return false;
    } finally {
        tgLinkState.loading = false;
        renderToolsPageUi();
    }
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
        const copied = document.execCommand('copy');
        if (!copied) {
            throw new Error('copy command rejected');
        }
    } finally {
        document.body.removeChild(textarea);
    }
}

async function reloadTgLink() {
    await loadTgLink(true, { notify: true });
}

async function copyTgLink() {
    if (!tgLinkState.value || tgLinkState.loading) {
        return;
    }

    try {
        await copyTextToClipboard(tgLinkState.value);
        showToast('tg_link.copied');
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        showToast('tg_link.copy_failed', { message });
    }
}

function renderStatusCard() {
    const card = document.getElementById('statusCard');
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');

    if (!currentStatus) {
        document.getElementById('pidBadge').textContent = 'PID --';
        document.getElementById('networkModeLabel').textContent = '--';
        document.getElementById('privateDnsLabel').textContent = '--';
        document.getElementById('tgRuntimeStateValue').textContent = '--';
        document.getElementById('tgHelperValue').textContent = '--';
        document.getElementById('tgListenValue').textContent = '--';
        document.getElementById('tgCfValue').textContent = '--';
        document.getElementById('rulesV4').textContent = '?';
        document.getElementById('rulesV6').textContent = '?';
        document.getElementById('domainCount').textContent = '?';
        document.getElementById('googleDomainCount').textContent = '?';
        document.getElementById('userDomainCount').textContent = '?';
        card.className = 'card status-card inactive';
        dot.className = 'status-dot off';
        label.className = 'status-label off';
        label.textContent = getStatusLabel();
        return;
    }

    const status = currentStatus;
    const isOn = Boolean(status.active);
    const pid = status.pid || '--';
    const pidCount = parseInt(status.pid_count || 0, 10);

    document.getElementById('version').textContent = status.version || t('common.unknown');
    document.getElementById('pidBadge').textContent = pidCount > 1 ? `PID ${pid} +${pidCount - 1}` : `PID ${pid}`;
    document.getElementById('networkModeLabel').textContent = getNetworkModeDisplayLabel(status);
    document.getElementById('privateDnsLabel').textContent = getPrivateDnsDisplayLabel(status);
    document.getElementById('tgRuntimeStateValue').textContent = getTgRuntimeStateLabel(status);
    document.getElementById('tgHelperValue').textContent = getTgHelperLabel(status);
    document.getElementById('tgListenValue').textContent = getTgListenLabel(status);
    document.getElementById('tgCfValue').textContent = getTgCfLabel(status);
    document.getElementById('rulesV4').textContent = status.rules_v4 ?? 0;
    document.getElementById('rulesV6').textContent = status.rules_v6 ?? 0;
    document.getElementById('domainCount').textContent = formatNumber(status.domain_count ?? 0);
    document.getElementById('googleDomainCount').textContent = formatNumber(status.google_domain_count ?? 0);
    document.getElementById('userDomainCount').textContent = formatNumber(status.user_domain_count ?? 0);

    card.className = 'card status-card ' + (isOn ? 'active' : 'inactive');
    dot.className = 'status-dot ' + (isOn ? 'on' : 'off');
    label.className = 'status-label ' + (isOn ? 'on' : 'off');
    label.textContent = getStatusLabel();
}

function renderNetworkModeControls(status = currentStatus) {
    const dirtyNote = document.getElementById('networkModeDirtyNote');
    const saveButton = document.getElementById('btnSaveNetworkMode');
    const buttons = document.querySelectorAll('[data-network-mode]');
    const mode = getSelectedNetworkMode(status);
    const dirty = isNetworkModeDirty(status);
    const controlsDisabled = isLoading || !status;
    const autoUnavailable = Boolean(status && status.ipv6_available === false);
    const selectedAutoUnavailable = mode === 'auto' && autoUnavailable;

    if (dirtyNote) {
        if (!status) {
            dirtyNote.textContent = t('network.dirty_none');
        } else if (autoUnavailable) {
            dirtyNote.textContent = t('network.ipv6_unavailable');
        } else {
            dirtyNote.textContent = dirty ? t('network.dirty_unsaved') : t('network.dirty_none');
        }
        dirtyNote.classList.toggle('warning', dirty || autoUnavailable);
    }

    buttons.forEach((button) => {
        const active = mode && button.dataset.networkMode === mode;
        const unavailable = button.dataset.networkMode === 'auto' && autoUnavailable && !active;
        button.classList.toggle('active', active);
        button.title = unavailable ? t('network.enable_ipv6_hint') : '';
        setButtonDisabled(button, controlsDisabled || unavailable);
    });

    if (saveButton) {
        saveButton.textContent = status && status.active ? t('common.save_restart') : t('common.save');
        setButtonDisabled(saveButton, controlsDisabled || !dirty || selectedAutoUnavailable);
    }
}

function showNetworkModeCheckingHint() {
    if (!currentStatus || currentStatus.ipv6_available !== false) return;

    const dirtyNote = document.getElementById('networkModeDirtyNote');
    if (!dirtyNote) return;

    dirtyNote.textContent = t('network.ipv6_checking');
    dirtyNote.classList.add('warning');
}

function refreshStatusFromUiEvent() {
    if (isLoading) return;
    showNetworkModeCheckingHint();
    refreshStatus(true);
}

function handleWebUiActivated() {
    refreshStatusFromUiEvent();
    refreshActivePageData({ forceUserList: true });
}

function renderPrivateDnsControls(status = currentStatus) {
    const note = document.getElementById('privateDnsNote');
    const input = document.getElementById('privateDnsHostnameInput');
    const applyButton = document.getElementById('btnApplyPrivateDnsHostname');
    const buttons = document.querySelectorAll('[data-private-dns-mode]');
    const defaultHost = getPrivateDnsDefaultHostname(status);
    const mode = status && status.private_dns_mode ? status.private_dns_mode : '';
    const hostname = status && status.private_dns_hostname ? status.private_dns_hostname : '';
    const controlsDisabled = isLoading || !status || status.private_dns_available === false;

    if (note) {
        note.textContent = getPrivateDnsNote(status);
        note.classList.toggle('warning', Boolean(status && status.private_dns_available === false));
    }

    if (input) {
        if (!privateDnsInputDirty && document.activeElement !== input) {
            input.value = hostname || defaultHost;
        }
        input.placeholder = defaultHost;
    }

    buttons.forEach((button) => {
        let active = false;
        if (button.dataset.privateDnsMode === 'off') {
            active = mode === 'off';
        } else if (button.dataset.privateDnsMode === 'auto') {
            active = mode === 'opportunistic';
        } else if (button.dataset.privateDnsMode === 'default') {
            active = mode === 'hostname' && hostname === defaultHost;
        }
        button.classList.toggle('active', active);
        setButtonDisabled(button, controlsDisabled);
    });

    if (applyButton) {
        const canApply = input && isValidPrivateDnsHostname(input.value);
        setButtonDisabled(applyButton, controlsDisabled || !canApply);
    }
}

function renderUserListPane() {
    const pane = document.getElementById('userListPane');
    if (!pane) return;

    const busy = isLoading || userListRequestInFlight;
    const savedEntries = new Set(parseUserListEntries(userListSnapshot));
    if (!userListEntries.length) {
        pane.classList.add('empty');
        pane.innerHTML = `<div class="user-list-empty">${esc(t('user_list.empty'))}</div>`;
        return;
    }

    pane.classList.remove('empty');
    pane.innerHTML = userListEntries.map((domain) => `
        <div class="user-list-item">
            <div class="event-dot userlist ${savedEntries.has(domain) ? 'saved' : 'pending'}"></div>
            <div class="event-body">
                <div class="user-list-domain">${esc(domain)}</div>
            </div>
            <button
                class="user-list-remove-btn${busy ? ' disabled' : ''}"
                type="button"
                data-remove-domain="${esc(domain)}"
                aria-label="${esc(t('common.remove_domain'))}"
                title="${esc(t('common.remove_domain'))}"
                ${busy ? 'disabled' : ''}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
        </div>
    `).join('');
}

function updateUserListEditorState() {
    const quickInput = document.getElementById('userListQuickInput');
    if (!quickInput) return;

    const entries = userListEntries.slice();
    const comparableText = toComparableUserListText(entries);
    const isDirty = comparableText !== userListSnapshot;
    const hasPendingInput = Boolean(quickInput.value.trim());

    document.getElementById('userListCountBadge').textContent = tc('counts.domains', entries.length);
    document.getElementById('userListDirtyNote').textContent = isDirty ? t('user_list.dirty_unsaved') : t('user_list.dirty_none');
    document.getElementById('userListDirtyNote').classList.toggle('warning', isDirty);

    const note = document.getElementById('userListBindingNote');
    const attached = currentStatus && typeof currentStatus.user_list_attached === 'boolean'
        ? currentStatus.user_list_attached
        : null;
    if (attached === false) {
        note.textContent = t('user_list.binding_missing');
    } else if (attached === true) {
        note.textContent = t('user_list.binding_applied');
    } else {
        note.textContent = t('user_list.binding_unknown');
    }
    note.classList.toggle('warning', attached === false);

    const busy = isLoading || userListRequestInFlight;
    renderUserListPane();
    setButtonDisabled(document.getElementById('btnSaveUserList'), busy || !isDirty);
    setButtonDisabled(document.getElementById('btnReloadUserList'), busy);
    setButtonDisabled(document.getElementById('btnAddUserListDomain'), busy || !hasPendingInput);
}

function setupUserListEditor() {
    const quickInput = document.getElementById('userListQuickInput');
    const pane = document.getElementById('userListPane');
    if (!quickInput || !pane || quickInput.dataset.bound === '1') return;
    quickInput.dataset.bound = '1';
    quickInput.addEventListener('input', updateUserListEditorState);
    quickInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addUserListDomain();
        }
    });
    pane.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-domain]');
        if (!button) return;
        removeUserListDomain(button.getAttribute('data-remove-domain') || '');
    });
    updateUserListEditorState();
}

function setupPrivateDnsControls() {
    const input = document.getElementById('privateDnsHostnameInput');
    if (!input || input.dataset.bound === '1') return;

    input.dataset.bound = '1';
    input.addEventListener('input', () => {
        privateDnsInputDirty = true;
        renderPrivateDnsControls();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyPrivateDnsHostname();
        }
    });
    input.addEventListener('blur', () => {
        if (!input.value.trim()) {
            privateDnsInputDirty = false;
        }
        renderPrivateDnsControls();
    });

    renderPrivateDnsControls();
}

function updatePageButtons() {
    Object.entries(PAGE_VIEWS).forEach(([page, config]) => {
        document.getElementById(config.buttonId).classList.toggle('active', activePage === page);
    });
}

function renderPages() {
    Object.entries(PAGE_VIEWS).forEach(([page, config]) => {
        document.getElementById(config.pageId).classList.toggle('active', activePage === page);
    });
    updatePageButtons();
    syncLogPolling();
}

async function setPage(page) {
    activePage = page;
    renderPages();
    await refreshActivePageData();
}

function updateTabButtons() {
    Object.entries(LOG_VIEWS).forEach(([view, config]) => {
        document.getElementById(config.tabId).classList.toggle('active', activeLogView === view);
    });
}

function updateLogMeta() {
    const meta = document.getElementById('logMeta');
    if (activeLogView === 'events') {
        const count = getLogViewState('events').items.length;
        meta.textContent = count ? tc('counts.events', count) : t('logs.event_history');
    } else {
        meta.textContent = t('logs.runtime_meta');
    }
}

function updateStatusBar() {
    const isLive = activeLogView === 'runtime' && logInterval !== null;
    const clearButton = document.getElementById('btnClearEvents');
    const jumpButton = document.getElementById('logJumpBtn');
    document.getElementById('logLiveDot').hidden = !isLive;
    document.getElementById('logLiveLabel').hidden = !isLive;
    document.getElementById('logLiveSep').hidden = !isLive;

    if (activeLogView === 'runtime') {
        const runtimeState = getLogViewState('runtime');
        if (runtimeState.loaded) {
            const lines = runtimeState.text ? runtimeState.text.split('\n').length : 0;
            document.getElementById('logLineCount').textContent = tc('counts.lines', lines);
        } else {
            document.getElementById('logLineCount').textContent = '--';
        }
        clearButton.hidden = true;
        jumpButton.classList.toggle('visible', isLogViewScrolledUp('runtime'));
    } else {
        document.getElementById('logLineCount').textContent = tc('counts.entries', getLogViewState('events').items.length);
        clearButton.hidden = false;
        jumpButton.classList.remove('visible');
    }
}

function renderEventsPane() {
    const pane = getLogPane('events');
    const previousScrollTop = pane.scrollTop;
    const items = getLogViewState('events').items;
    const markup = !items.length
        ? `<div class="events-empty">${esc(t('logs.events_empty'))}</div>`
        : items.map((evt) => {
            const typeLower = (evt.type || '').toLowerCase();
            return `<div class="event-item">
            <div class="event-dot ${typeLower}"></div>
            <div class="event-body">
                <div class="event-head">
                    <span class="event-type">${esc(evt.type)}</span>
                    <span class="event-time">${esc(evt.time ? evt.time.substring(11) : '')}</span>
                </div>
                <div class="event-msg">${esc(evt.message)}</div>
            </div>
        </div>`;
        }).join('');
    const changed = updatePaneContent(pane, markup, { html: true });

    if (!items.length) {
        setLogViewScrolledUp('events', false);
        return;
    }

    if (!changed) {
        return;
    }

    syncLogPaneScroll('events', pane, previousScrollTop);
}

function getDiagnoseButtonMarkup(label) {
    return `
        <span class="diag-run-btn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3.25c.45 0 .86.24 1.07.63l8.27 15.2c.2.37.2.83-.02 1.19-.21.36-.6.58-1.02.58H3.7c-.42 0-.81-.22-1.02-.58-.22-.36-.22-.82-.02-1.19l8.27-15.2c.21-.39.62-.63 1.07-.63zm0 5.25a1.03 1.03 0 00-1.03 1.03v4.62a1.03 1.03 0 102.06 0V9.53A1.03 1.03 0 0012 8.5zm0 9.06a1.16 1.16 0 100-2.32 1.16 1.16 0 000 2.32z"/></svg>
        </span>
        <span class="diag-run-btn-label">${esc(label)}</span>
    `;
}

function setDiagnoseButtonState(button, label, loading = false) {
    if (!button) return;
    button.classList.toggle('loading', loading);
    button.innerHTML = getDiagnoseButtonMarkup(label);
}

function rerenderDiagnoseButton() {
    const button = document.getElementById('btnDiagnose');
    if (!button) return;
    const loading = button.classList.contains('loading');
    setDiagnoseButtonState(button, t(loading ? 'diagnostics.running' : 'diagnostics.run'), loading);
}

function clearDiagnostics() {
    diagnosticsData = null;
    diagnosticsExpanded = false;
    renderDiagnosticsPanel();
}

function toggleDiagnosticsDetails() {
    if (!diagnosticsData) return;
    diagnosticsExpanded = !diagnosticsExpanded;
    renderDiagnosticsPanel();
}

function getLocalizedDiagnoseName(check) {
    switch (check.code) {
    case 'process':
        return t('diagnostics.names.process', { subject: check.subject || 'nfqws2' });
    case 'userlist_binding':
        return t('diagnostics.names.userlist_binding');
    case 'network_mode':
        return t('diagnostics.names.network_mode');
    case 'private_dns':
        return t('diagnostics.names.private_dns');
    case 'routing':
        return check.family === 'ipv6'
            ? t('diagnostics.names.routing_ipv6')
            : t('diagnostics.names.routing_ipv4');
    case 'jump_rule':
        return check.table && check.hook ? `${check.table} ${check.hook}` : (check.name || '');
    case 'command':
    case 'ip6tables_runtime':
    case 'runtime_file':
        return check.subject || check.name || '';
    default:
        return check.name || '';
    }
}

function getLocalizedDiagnoseDetail(check) {
    switch (check.code) {
    case 'command':
        if (check.detail_code === 'available') return t('diagnostics.details.command_available');
        if (check.detail_code === 'missing') return t('diagnostics.details.command_missing');
        break;
    case 'ip6tables_runtime':
        if (check.detail_code === 'not_required') return t('diagnostics.details.ip6tables_not_required');
        if (check.detail_code === 'available') return t('diagnostics.details.ip6tables_available');
        if (check.detail_code === 'unusable') return t('diagnostics.details.ip6tables_unusable');
        if (check.detail_code === 'missing_fallback') return t('diagnostics.details.ip6tables_missing_fallback');
        break;
    case 'runtime_file':
        if (check.detail_code === 'present') return t('diagnostics.details.runtime_file_present');
        if (check.detail_code === 'missing') return t('diagnostics.details.runtime_file_missing');
        break;
    case 'process':
        if (check.detail_code === 'running') return t('diagnostics.details.process_running', { pid: check.pid || '?' });
        if (check.detail_code === 'not_running') return t('diagnostics.details.process_not_running');
        break;
    case 'userlist_binding':
        if (check.detail_code === 'attached') return t('diagnostics.details.userlist_attached');
        if (check.detail_code === 'detached') return t('diagnostics.details.userlist_detached');
        break;
    case 'network_mode':
        if (check.detail_code === 'ipv4_only') return t('diagnostics.details.network_ipv4_only');
        if (check.detail_code === 'auto_dual_stack') return t('diagnostics.details.network_auto_dual');
        if (check.detail_code === 'auto_ipv4_fallback') return t('diagnostics.details.network_auto_fallback');
        break;
    case 'private_dns':
        if (check.detail_code === 'unavailable') return t('diagnostics.details.private_dns_unavailable');
        if (check.detail_code === 'off') return t('diagnostics.details.private_dns_off');
        if (check.detail_code === 'auto') return t('diagnostics.details.private_dns_auto');
        if (check.detail_code === 'hostname_default') {
            return t('diagnostics.details.private_dns_hostname_default', {
                hostname: check.hostname || check.default_hostname || getPrivateDnsDefaultHostname()
            });
        }
        if (check.detail_code === 'hostname_custom') {
            return t('diagnostics.details.private_dns_hostname_custom', {
                hostname: check.hostname || '?'
            });
        }
        if (check.detail_code === 'hostname_unspecified') return t('diagnostics.details.private_dns_hostname_unspecified');
        break;
    case 'jump_rule':
        if (check.detail_code === 'present') return t('diagnostics.details.jump_present');
        if (check.detail_code === 'missing') return t('diagnostics.details.jump_missing');
        if (check.detail_code === 'skipped_ipv4_only') return t('diagnostics.details.jump_skipped_ipv4_only');
        break;
    case 'routing':
        if (check.detail_code === 'ok') return t('diagnostics.details.routing_ok');
        if (check.detail_code === 'fail') return t('diagnostics.details.routing_fail');
        if (check.detail_code === 'disabled') return t('diagnostics.details.routing_disabled');
        break;
    default:
        break;
    }

    return check.detail || '';
}

function getLocalizedDiagnoseCheck(check) {
    return {
        status: check.status,
        name: getLocalizedDiagnoseName(check),
        detail: getLocalizedDiagnoseDetail(check)
    };
}

function renderDiagnosticsPanel() {
    const results = document.getElementById('diagResults');
    const checklistShell = document.getElementById('diagChecklistShell');
    const checklist = document.getElementById('diagChecklist');
    const summary = document.getElementById('diagSummary');
    const emptyState = document.getElementById('diagEmptyState');

    if (!diagnosticsData) {
        emptyState.hidden = false;
        results.hidden = true;
        checklistShell.hidden = true;
        checklist.innerHTML = '';
        summary.innerHTML = '';
        return;
    }

    emptyState.hidden = true;

    const counts = diagnosticsData.summary || { ok: 0, fail: 0, total: 0 };
    const checks = (diagnosticsData.checks || []).map(getLocalizedDiagnoseCheck);
    const toggleLabel = diagnosticsExpanded
        ? t('diagnostics.hide_details')
        : t('diagnostics.show_details', { count: formatNumber(checks.length) });

    summary.innerHTML = `
        <div class="diag-summary-main">
            <span class="diag-summary-text">
                ${esc(t('diagnostics.summary', {
                    ok: formatNumber(counts.ok),
                    fail: formatNumber(counts.fail),
                    total: formatNumber(counts.total)
                }))}
            </span>
            <span class="diag-summary-note">${esc(diagnosticsExpanded ? t('diagnostics.expanded') : t('diagnostics.collapsed'))}</span>
        </div>
        <div class="diag-summary-actions">
            <button class="diag-inline-btn" onclick="toggleDiagnosticsDetails()">${esc(toggleLabel)}</button>
            <button class="diag-inline-btn" onclick="clearDiagnostics()">${esc(t('common.clear'))}</button>
        </div>
    `;

    if (diagnosticsExpanded) {
        checklist.innerHTML = checks.map((check) => `
            <div class="diag-item">
                <div class="diag-icon ${check.status}">${check.status === 'ok' ? '✓' : '✗'}</div>
                <span class="diag-name">${esc(check.name)}</span>
                <span class="diag-detail">${esc(check.detail)}</span>
            </div>
        `).join('');
        checklistShell.hidden = false;
    } else {
        checklist.innerHTML = '';
        checklistShell.hidden = true;
    }

    results.hidden = false;
}

async function refreshEvents() {
    if (eventsRequestInFlight) return;
    eventsRequestInFlight = true;
    try {
        const res = await exec(`${CLI} events --json --tail=50`);
        const raw = (res.stdout || '').trim();
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        if (arrMatch) {
            const eventsState = getLogViewState('events');
            const payload = arrMatch[0];
            if (payload === eventsState.lastPayload) {
                return;
            }
            eventsState.items = JSON.parse(payload);
            eventsState.lastPayload = payload;
            if (activeLogView === 'events') {
                renderEventsPane();
                updateLogMeta();
                updateStatusBar();
            }
        }
    } catch (error) {
        console.error('Events refresh error:', error);
    } finally {
        eventsRequestInFlight = false;
    }
}

function renderRuntimeLog(options = {}) {
    const { forceBottom = false } = options;
    const pane = getLogPane('runtime');
    const previousScrollTop = pane.scrollTop;
    const runtimeState = getLogViewState('runtime');
    const nextText = !runtimeState.loaded
        ? t('logs.loading_runtime')
        : (runtimeState.text || t('logs.runtime_empty'));
    const changed = updatePaneContent(pane, nextText);

    if (!changed && !forceBottom) {
        return;
    }

    syncLogPaneScroll('runtime', pane, previousScrollTop, { forceBottom });
}

async function refreshLog() {
    if (logRequestInFlight) return;
    if (activeLogView !== 'runtime') return;

    logRequestInFlight = true;
    try {
        const res = await exec(`tail -n 80 ${MODDIR}/nzapret.log 2>/dev/null`);
        const runtimeState = getLogViewState('runtime');
        runtimeState.text = String(res.stdout || '').replace(/\r/g, '').trim();
        runtimeState.loaded = true;
        renderRuntimeLog();
        updateStatusBar();
    } finally {
        logRequestInFlight = false;
    }
}

function setupScrollTracking() {
    function onScroll(view) {
        const pane = getLogPane(view);
        const scrolledUp = !isPaneNearBottom(pane);
        setLogViewScrolledUp(view, scrolledUp);
        updateStatusBar();
    }

    Object.keys(LOG_VIEWS).forEach((view) => {
        getLogPane(view).addEventListener('scroll', () => onScroll(view));
    });
}

function jumpToBottom() {
    const activePane = getLogPane(activeLogView);
    scrollPaneToBottom(activePane);
    setLogViewScrolledUp(activeLogView, false);
    updateStatusBar();
}

function renderLogView() {
    Object.entries(LOG_VIEWS).forEach(([view, config]) => {
        document.getElementById(config.paneId).classList.toggle('active', activeLogView === view);
    });
    updateTabButtons();
    updateLogMeta();
    updateStatusBar();
}

function rerenderLogsUi() {
    renderRuntimeLog();
    renderEventsPane();
    renderLogView();
}

async function refreshToolsPageData(force = false) {
    await Promise.all([
        loadUserList(force),
        loadTgLink(force)
    ]);
}

function syncLogPolling() {
    if (activePage === 'logs' && activeLogView === 'runtime' && !document.hidden) {
        startLogPolling();
    } else {
        stopLogPolling();
    }

    if (activePage === 'logs' && activeLogView === 'events' && !document.hidden) {
        startEventsPolling();
    } else {
        stopEventsPolling();
    }
}

async function refreshActiveLogView() {
    if (activePage !== 'logs') return;

    if (activeLogView === 'runtime') {
        if (!getLogViewState('runtime').loaded) {
            renderRuntimeLog({ forceBottom: true });
        }
        await refreshLog();
    } else {
        await refreshEvents();
    }
}

async function refreshActivePageData(options = {}) {
    const { forceUserList = false } = options;

    if (activePage === 'tools') {
        await refreshToolsPageData(forceUserList);
        return;
    }

    if (activePage === 'logs') {
        await refreshActiveLogView();
    }
}

async function setLogView(view) {
    activeLogView = view;
    renderLogView();
    syncLogPolling();
    await refreshActiveLogView();
}

async function runDiagnose() {
    const button = document.getElementById('btnDiagnose');
    if (button.classList.contains('loading')) return;
    setDiagnoseButtonState(button, t('diagnostics.running'), true);

    try {
        setUiLocked(true, 'diagnostics.overlay_running');
        await waitForPaint();

        const res = await exec(`${CLI} diagnose --json`);
        const raw = (res.stdout || '').trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            showToast('diagnostics.failed');
            return;
        }

        diagnosticsData = JSON.parse(jsonMatch[0]);
        diagnosticsExpanded = false;
        renderDiagnosticsPanel();
        showToast('diagnostics.completed');
    } catch (error) {
        showToast('diagnostics.error', { message: error.message });
    } finally {
        setDiagnoseButtonState(button, t('diagnostics.run'));
        setUiLocked(false);
    }
}

function renderRuntimeActionButtons(isOn) {
    if (isLoading) return;

    document.getElementById('btnStart').classList.toggle('disabled', isOn);
    document.getElementById('btnStop').classList.toggle('disabled', !isOn);
    document.getElementById('btnRestart').classList.toggle('disabled', !isOn);
    document.getElementById('btnUpdate').classList.remove('disabled');
}

function renderRuntimePageUi(status = currentStatus) {
    renderStatusCard();
    renderRuntimeActionButtons(Boolean(status && status.active));
}

function renderToolsPageUi(status = currentStatus) {
    renderTgLinkCard(status);
    renderNetworkModeControls(status);
    renderPrivateDnsControls(status);
    updateUserListEditorState();
    rerenderDiagnoseButton();
    renderDiagnosticsPanel();
}

function applyUnavailableState() {
    currentStatus = null;
    statusViewState = 'unavailable';
    renderRuntimePageUi(null);
    renderToolsPageUi(null);
}

async function runCli(args, options = {}) {
    const {
        loadingKey = 'common.applying_changes',
        loadingParams = {},
        successKey = '',
        successParams = {},
        refresh = true
    } = options;

    if (isLoading) return { ok: false, skipped: true };

    isLoading = true;
    setUiLocked(true, loadingKey, loadingParams);
    await waitForPaint();

    try {
        const res = await exec(`${CLI} ${args}`);
        const stdout = (res.stdout || '').trim();
        const stderr = (res.stderr || '').trim();
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const ok = res.errno === 0;

        if (ok) {
            if (successKey) {
                showToast(successKey, successParams);
            }
            if (refresh) {
                await refreshStatus(true);
                await refreshActiveLogView();
            }
        } else {
            showToast('generic.error_with_message', {
                message: combined || args
            });
        }

        return { ok, output: combined };
    } catch (error) {
        showToast('generic.error_with_message', {
            message: error.message || String(error)
        });
        return { ok: false, output: String(error.message || error) };
    } finally {
        isLoading = false;
        setUiLocked(false);
        renderRuntimePageUi();
        renderToolsPageUi();
    }
}

function startLogPolling() {
    if (logInterval) clearInterval(logInterval);
    logInterval = setInterval(() => {
        if (!document.hidden) {
            refreshLog();
        }
    }, LOG_POLL_MS);
    updateStatusBar();
}

function stopLogPolling() {
    if (logInterval) {
        clearInterval(logInterval);
        logInterval = null;
    }
    updateStatusBar();
}

function startEventsPolling() {
    if (eventsInterval) return;
    eventsInterval = setInterval(() => {
        if (!document.hidden) {
            refreshEvents();
        }
    }, EVENTS_POLL_MS);
}

function stopEventsPolling() {
    if (eventsInterval) {
        clearInterval(eventsInterval);
        eventsInterval = null;
    }
}

function rerenderBaseUi() {
    applyStaticTranslations(document, getStaticTranslationParams());
    updateLocaleButtons();
    rerenderUiLock();
    rerenderToast();
}

function rerenderNonLogUi() {
    rerenderBaseUi();
    renderRuntimePageUi();
    renderToolsPageUi();
}

function rerenderAppUi() {
    rerenderNonLogUi();
    rerenderLogsUi();
}

async function refreshStatus(force = false) {
    if ((!force && isLoading) || statusRequestInFlight) return;
    statusRequestInFlight = true;

    try {
        const res = await exec(`${CLI} status --json`);
        const raw = (res.stdout || '').trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            throw new Error((raw || res.stderr || 'status command failed').trim());
        }

        currentStatus = JSON.parse(jsonMatch[0]);
        statusViewState = 'ready';
        hasShownStatusError = false;
        rerenderNonLogUi();
    } catch (error) {
        applyUnavailableState();
        if (!hasShownStatusError) {
            showToast('status.refresh_failed');
            hasShownStatusError = true;
        }
        console.error('Status refresh error:', error);
    } finally {
        statusRequestInFlight = false;
    }
}

function getActionLabel(command) {
    switch (command) {
    case 'start':
        return t('actions.start');
    case 'stop':
        return t('actions.stop');
    case 'restart':
        return t('actions.restart');
    case 'update':
        return t('actions.update');
    default:
        return command;
    }
}

async function doAction(command) {
    const primary = command.split(' ')[0];
    const buttonMap = {
        start: 'btnStart',
        stop: 'btnStop',
        restart: 'btnRestart',
        update: 'btnUpdate'
    };
    const loadingMap = {
        start: 'actions.starting',
        stop: 'actions.stopping',
        restart: 'actions.restarting',
        update: 'actions.updating_data'
    };
    const buttonId = buttonMap[primary];
    const button = buttonId ? document.getElementById(buttonId) : null;

    if (button && button.classList.contains('disabled')) return;
    if (button) button.classList.add('loading');

    await runCli(command, {
        loadingKey: loadingMap[primary] || 'common.applying_changes',
        successKey: 'actions.completed',
        successParams: { command: getActionLabel(primary) }
    });

    if (button) button.classList.remove('loading');
}

async function setNetworkMode(mode) {
    if (isLoading || !currentStatus) return;
    if (mode === 'auto' && currentStatus.ipv6_available === false && currentStatus.network_mode !== 'auto') {
        showToast('network.auto_requires_ipv6');
        return;
    }

    if (currentStatus.network_mode === mode) {
        networkModeDraft = '';
    } else {
        networkModeDraft = mode;
    }

    renderNetworkModeControls(currentStatus);
}

async function saveNetworkMode() {
    if (isLoading || !currentStatus || !isNetworkModeDirty(currentStatus)) return;

    const selectedMode = getSelectedNetworkMode(currentStatus);
    if (selectedMode === 'auto' && currentStatus.ipv6_available === false) {
        showToast('network.auto_requires_ipv6');
        return;
    }

    const shouldRestart = Boolean(currentStatus.active);

    isLoading = true;
    setUiLocked(true, shouldRestart ? 'network.saving_restart' : 'network.saving');
    await waitForPaint();

    let savedMode = false;
    try {
        const saveRes = await exec(`${CLI} network set ${shellQuote(selectedMode)}`);
        if (saveRes.errno !== 0) {
            const details = [saveRes.stdout || '', saveRes.stderr || ''].join('\n').trim();
            throw new Error(details || 'network set failed');
        }
        savedMode = true;

        if (shouldRestart) {
            const restartRes = await exec(`${CLI} restart`);
            if (restartRes.errno !== 0) {
                const details = [restartRes.stdout || '', restartRes.stderr || ''].join('\n').trim();
                throw new Error(details || 'restart failed');
            }
        }

        networkModeDraft = '';
        await refreshStatus(true);
        await refreshActiveLogView();
        showToast(shouldRestart ? 'network.saved_restart' : 'network.saved');
    } catch (error) {
        if (savedMode) {
            networkModeDraft = '';
            await refreshStatus(true);
            showToast(shouldRestart ? 'network.saved_restart_failed' : 'network.saved');
        } else {
            showToast('generic.error_with_message', { message: error.message });
        }
    } finally {
        isLoading = false;
        setUiLocked(false);
        renderRuntimePageUi();
        renderToolsPageUi();
    }
}

async function setPrivateDnsMode(mode) {
    if (isLoading || !currentStatus || currentStatus.private_dns_available === false) return;

    const currentMode = currentStatus.private_dns_mode || '';
    if ((mode === 'off' && currentMode === 'off')
        || (mode === 'auto' && currentMode === 'opportunistic')) {
        return;
    }

    const result = await runCli(`dns set ${shellQuote(mode)}`, {
        loadingKey: mode === 'off' ? 'private_dns.loading_disable' : 'private_dns.loading_auto',
        successKey: 'private_dns.updated'
    });
    if (result.ok) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls(currentStatus);
    }
}

async function setPrivateDnsDefault() {
    if (isLoading || !currentStatus || currentStatus.private_dns_available === false) return;

    const defaultHost = getPrivateDnsDefaultHostname(currentStatus);
    if (currentStatus.private_dns_mode === 'hostname' && currentStatus.private_dns_hostname === defaultHost) {
        return;
    }

    const result = await runCli('dns set default', {
        loadingKey: 'private_dns.loading_default',
        loadingParams: { hostname: defaultHost },
        successKey: 'private_dns.updated'
    });
    if (result.ok) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls(currentStatus);
    }
}

async function applyPrivateDnsHostname() {
    if (isLoading || !currentStatus || currentStatus.private_dns_available === false) return;

    const input = document.getElementById('privateDnsHostnameInput');
    if (!input) return;

    const hostname = input.value.trim().toLowerCase();
    if (!isValidPrivateDnsHostname(hostname)) {
        showToast('private_dns.invalid_hostname');
        renderPrivateDnsControls(currentStatus);
        return;
    }

    if (currentStatus.private_dns_mode === 'hostname' && currentStatus.private_dns_hostname === hostname) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls(currentStatus);
        return;
    }

    const result = await runCli(`dns set hostname ${shellQuote(hostname)}`, {
        loadingKey: 'private_dns.loading_hostname',
        successKey: 'private_dns.updated'
    });
    if (result.ok) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls(currentStatus);
    }
}

async function loadUserList(force = false) {
    if ((!force && userListLoaded) || userListRequestInFlight) {
        updateUserListEditorState();
        return true;
    }

    userListRequestInFlight = true;
    updateUserListEditorState();

    try {
        const res = await exec(`${CLI} list-user show`);
        if (res.errno !== 0) {
            const details = [res.stdout || '', res.stderr || ''].join('\n').trim();
            throw new Error(details || 'list-user show failed');
        }
        const raw = (res.stdout || '').replace(/\r/g, '');
        const quickInput = document.getElementById('userListQuickInput');
        userListEntries = parseUserListEntries(raw);
        if (quickInput) {
            quickInput.value = '';
        }
        userListSnapshot = toComparableUserListText(userListEntries);
        userListLoaded = true;
        return true;
    } catch (error) {
        console.error('Failed to load user list:', error);
        showToast('user_list.load_failed');
        return false;
    } finally {
        userListRequestInFlight = false;
        updateUserListEditorState();
    }
}

async function reloadUserList() {
    if (isLoading || userListRequestInFlight) return;
    const loaded = await loadUserList(true);
    if (loaded) {
        showToast('user_list.reloaded');
    }
}

function addUserListDomain() {
    if (isLoading || userListRequestInFlight) return;

    const quickInput = document.getElementById('userListQuickInput');
    if (!quickInput) return;

    const domain = quickInput.value.trim();
    if (!domain) return;
    if (domain.startsWith('#')) {
        showToast('user_list.comments_not_added');
        return;
    }

    if (userListEntries.includes(domain)) {
        showToast('user_list.already_exists');
        quickInput.select();
        updateUserListEditorState();
        return;
    }

    userListEntries = [...userListEntries, domain];
    quickInput.value = '';
    updateUserListEditorState();
    quickInput.focus();
}

function removeUserListDomain(domain) {
    if (isLoading || userListRequestInFlight || !domain) return;

    const index = userListEntries.indexOf(domain);
    if (index === -1) return;

    userListEntries = [
        ...userListEntries.slice(0, index),
        ...userListEntries.slice(index + 1)
    ];
    updateUserListEditorState();
}

async function saveUserList() {
    if (isLoading || userListRequestInFlight) return;

    const entries = userListEntries.slice();
    const command = entries.length
        ? `list-user replace ${entries.map(shellQuote).join(' ')}`
        : 'list-user clear';

    const result = await runCli(command, {
        loadingKey: entries.length ? 'user_list.saving' : 'user_list.clearing',
        successKey: entries.length ? 'user_list.saved' : 'user_list.cleared'
    });

    if (result.ok) {
        await loadUserList(true);
    }
}

async function clearEventsLog() {
    if (activeLogView !== 'events' || isLoading) return;

    const button = document.getElementById('btnClearEvents');
    if (button.classList.contains('loading')) return;

    button.classList.add('loading');

    try {
        setUiLocked(true, 'logs.clearing_events');
        await waitForPaint();

        const res = await exec(`${CLI} events clear`);
        const ok = res.errno === 0;

        if (!ok) {
            throw new Error((res.stderr || res.stdout || 'events clear failed').trim());
        }

        const eventsState = getLogViewState('events');
        eventsState.items = [];
        eventsState.lastPayload = '[]';
        setLogViewScrolledUp('events', false);
        renderEventsPane();
        updateLogMeta();
        updateStatusBar();
        showToast('logs.cleared_events');
        await refreshEvents();
    } catch (error) {
        showToast('logs.clear_failed', { message: error.message });
    } finally {
        button.classList.remove('loading');
        setUiLocked(false);
    }
}

function changeLocale(locale) {
    setI18nLocale(locale);
    rerenderAppUi();
}

function setupLocaleControls() {
    document.querySelectorAll('[data-locale]').forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
            changeLocale(button.dataset.locale || 'ru');
        });
    });
    updateLocaleButtons();
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        handleWebUiActivated();
    }
    syncLogPolling();
});

window.doAction = doAction;
window.setPage = setPage;
window.setNetworkMode = setNetworkMode;
window.saveNetworkMode = saveNetworkMode;
window.setPrivateDnsMode = setPrivateDnsMode;
window.setPrivateDnsDefault = setPrivateDnsDefault;
window.applyPrivateDnsHostname = applyPrivateDnsHostname;
window.reloadUserList = reloadUserList;
window.addUserListDomain = addUserListDomain;
window.saveUserList = saveUserList;
window.setLogView = setLogView;
window.clearEventsLog = clearEventsLog;
window.runDiagnose = runDiagnose;
window.toggleDiagnosticsDetails = toggleDiagnosticsDetails;
window.clearDiagnostics = clearDiagnostics;
window.jumpToBottom = jumpToBottom;
window.reloadTgLink = reloadTgLink;
window.copyTgLink = copyTgLink;

setupLocaleControls();
setupScrollTracking();
setupUserListEditor();
setupPrivateDnsControls();
rerenderAppUi();
renderPages();
refreshStatus();
