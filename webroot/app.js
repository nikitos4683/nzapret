import { exec } from './kernelsu.js';
import { CLI, MODDIR, matchJson, combineOutput } from './cli.js';
import {
    esc,
    isPaneNearBottom,
    isValidPrivateDnsHostname,
    parseUserListEntries,
    scrollPaneToBottom,
    setButtonDisabled,
    setPaneScrollTop,
    shellQuote,
    toComparableUserListText,
    updatePaneContent,
    waitForPaint
} from './utils.js';
import {
    applyStaticTranslations,
    formatNumber,
    getLocale,
    initializeLocale,
    setLocale as setI18nLocale,
    t,
    tc
} from './i18n.js';

const LOG_POLL_MS = 3000;
const EVENTS_POLL_MS = 5000;
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
    nztg: {
        paneId: 'nztgLogPane',
        tabId: 'btnNztgTab'
    },
    events: {
        paneId: 'eventsPane',
        tabId: 'btnEventsTab'
    }
};
// Text-based log views (as opposed to the structured events view) and the file
// each one tails.
const TEXT_LOG_FILES = {
    runtime: 'nzapret.log',
    nztg: 'nztg.log'
};
function isTextLog(view) {
    return Object.prototype.hasOwnProperty.call(TEXT_LOG_FILES, view);
}

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
    nztg: {
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
let userListEntries = [];
let userListLoaded = false;
let userListRequestInFlight = false;
let userListSnapshot = '';
let diagnosticsData = null;
let diagnosticsExpanded = false;
let privateDnsInputDirty = false;
let tgConfig = null;
let tgLoaded = false;
let tgRequestInFlight = false;
let tgSnapshot = null;
let toastTimer = null;
let toastState = null;
let uiLockState = {
    locked: false,
    message: 'common.applying_changes',
    params: {},
    translate: true
};

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

function getPrivateDnsDefaultHostname(status = currentStatus) {
    return status && status.private_dns_default_hostname
        ? status.private_dns_default_hostname
        : 'xbox-dns.ru';
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

function renderStatusCard() {
    const card = document.getElementById('statusCard');
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');

    if (!currentStatus) {
        document.getElementById('pidBadge').textContent = 'nfqws2 --';
        document.getElementById('tgPidBadge').textContent = 'nztg --';
        document.getElementById('privateDnsLabel').textContent = '--';
        document.getElementById('tgStatusValue').textContent = '--';
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
    document.getElementById('pidBadge').textContent = pidCount > 1 ? `nfqws2 ${pid} +${pidCount - 1}` : `nfqws2 ${pid}`;
    const tgPidBadge = document.getElementById('tgPidBadge');
    tgPidBadge.textContent = `nztg ${status.tg_pid || '--'}`;
    document.getElementById('privateDnsLabel').textContent = getPrivateDnsDisplayLabel(status);
    if (status.tg_active) {
        const port = status.tg_port || '1443';
        const isCf = Boolean(status.tg_cf_enabled);
        document.getElementById('tgStatusValue').textContent = isCf
            ? t('status.tg_port_cf', { port })
            : t('status.tg_port', { port });
    } else {
        document.getElementById('tgStatusValue').textContent = t('status.off');
    }
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

function refreshStatusFromUiEvent() {
    if (isLoading) return;
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

// Lightweight handler for typing in the quick-add field: only the Add button
// depends on the input, so avoid rebuilding the whole domain-list pane here.
function updateUserListAddButton() {
    const quickInput = document.getElementById('userListQuickInput');
    if (!quickInput) return;
    const busy = isLoading || userListRequestInFlight;
    const hasPendingInput = Boolean(quickInput.value.trim());
    setButtonDisabled(document.getElementById('btnAddUserListDomain'), busy || !hasPendingInput);
}

function setupUserListEditor() {
    const quickInput = document.getElementById('userListQuickInput');
    const pane = document.getElementById('userListPane');
    if (!quickInput || !pane || quickInput.dataset.bound === '1') return;
    quickInput.dataset.bound = '1';
    quickInput.addEventListener('input', updateUserListAddButton);
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
    } else if (activeLogView === 'nztg') {
        meta.textContent = t('logs.nztg_meta');
    } else {
        meta.textContent = t('logs.runtime_meta');
    }
}

function updateStatusBar() {
    const isLive = isTextLog(activeLogView) && logInterval !== null;
    const clearButton = document.getElementById('btnClearEvents');
    const jumpButton = document.getElementById('logJumpBtn');
    document.getElementById('logLiveDot').hidden = !isLive;
    document.getElementById('logLiveLabel').hidden = !isLive;
    document.getElementById('logLiveSep').hidden = !isLive;

    if (isTextLog(activeLogView)) {
        const state = getLogViewState(activeLogView);
        if (state.loaded) {
            const lines = state.text ? state.text.split('\n').length : 0;
            document.getElementById('logLineCount').textContent = tc('counts.lines', lines);
        } else {
            document.getElementById('logLineCount').textContent = '--';
        }
        clearButton.hidden = true;
        jumpButton.classList.toggle('visible', isLogViewScrolledUp(activeLogView));
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
        case 'ip_stack':
            return t('diagnostics.names.ip_stack');
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
        case 'ip_stack':
            if (check.detail_code === 'ipv4_only') return t('diagnostics.details.stack_ipv4_only');
            if (check.detail_code === 'dual_stack') return t('diagnostics.details.stack_dual');
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
            if (check.detail_code === 'skipped_no_ipv6') return t('diagnostics.details.jump_skipped_no_ipv6');
            break;
        case 'routing':
            if (check.detail_code === 'ok') return t('diagnostics.details.routing_ok');
            if (check.detail_code === 'fail') return t('diagnostics.details.routing_fail');
            if (check.detail_code === 'unavailable') return t('diagnostics.details.routing_unavailable');
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

    const passed = `<span class="pass-count">${esc(t('diagnostics.summary_passed', { ok: formatNumber(counts.ok) }))}</span>`;
    const failed = `<span class="fail-count">${esc(t('diagnostics.summary_failed', { fail: formatNumber(counts.fail) }))}</span>`;
    const summaryText = t('diagnostics.summary', { passed, failed, total: esc(formatNumber(counts.total)) });

    summary.innerHTML = `
        <div class="diag-summary-main">
            <span class="diag-summary-text">${summaryText}</span>
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
        const payload = matchJson(res, { array: true });
        if (payload) {
            const eventsState = getLogViewState('events');
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

function renderTextLog(view, options = {}) {
    const { forceBottom = false } = options;
    const pane = getLogPane(view);
    const previousScrollTop = pane.scrollTop;
    const state = getLogViewState(view);
    const nextText = !state.loaded
        ? t('logs.loading_runtime')
        : (state.text || t('logs.runtime_empty'));
    const changed = updatePaneContent(pane, nextText);

    if (!changed && !forceBottom) {
        return;
    }

    syncLogPaneScroll(view, pane, previousScrollTop, { forceBottom });
}

async function refreshTextLog(view) {
    if (logRequestInFlight) return;
    if (!isTextLog(view) || activeLogView !== view) return;

    logRequestInFlight = true;
    try {
        const res = await exec(`tail -n 80 ${MODDIR}/${TEXT_LOG_FILES[view]} 2>/dev/null`);
        const state = getLogViewState(view);
        state.text = String(res.stdout || '').replace(/\r/g, '').trim();
        state.loaded = true;
        renderTextLog(view);
        updateStatusBar();
    } finally {
        logRequestInFlight = false;
    }
}

function setupScrollTracking() {
    // Coalesce bursts of scroll events into a single per-frame DOM update so
    // dragging the log panes stays smooth instead of thrashing layout.
    let scrollFrame = null;
    let pendingView = null;

    function flushScroll() {
        scrollFrame = null;
        const view = pendingView;
        pendingView = null;
        if (!view) return;
        const pane = getLogPane(view);
        setLogViewScrolledUp(view, !isPaneNearBottom(pane));
        updateStatusBar();
    }

    function onScroll(view) {
        pendingView = view;
        if (scrollFrame === null) {
            scrollFrame = requestAnimationFrame(flushScroll);
        }
    }

    Object.keys(LOG_VIEWS).forEach((view) => {
        getLogPane(view).addEventListener('scroll', () => onScroll(view), { passive: true });
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
    renderTextLog('runtime');
    renderTextLog('nztg');
    renderEventsPane();
    renderLogView();
}

async function refreshToolsPageData(force = false) {
    await loadUserList(force);
    await loadTgConfig(force);
}

function syncLogPolling() {
    if (activePage === 'logs' && isTextLog(activeLogView) && !document.hidden) {
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

    if (isTextLog(activeLogView)) {
        if (!getLogViewState(activeLogView).loaded) {
            renderTextLog(activeLogView, { forceBottom: true });
        }
        await refreshTextLog(activeLogView);
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
        const payload = matchJson(res);

        if (!payload) {
            showToast('diagnostics.failed');
            return;
        }

        diagnosticsData = JSON.parse(payload);
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
    renderPrivateDnsControls(status);
    updateUserListEditorState();
    renderTgCard();
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
        const combined = combineOutput(res);
        const ok = res.errno === 0;

        if (ok) {
            if (successKey) {
                showToast(successKey, successParams);
            }
            if (refresh) {
                await Promise.all([refreshStatus(true), refreshActiveLogView()]);
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
            refreshTextLog(activeLogView);
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
        const payload = matchJson(res);

        if (!payload) {
            throw new Error(combineOutput(res) || 'status command failed');
        }

        currentStatus = JSON.parse(payload);
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
            throw new Error(combineOutput(res) || 'list-user show failed');
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

// ---- Telegram proxy (nztgproxy) ----
function tgInputs() {
    return {
        host: document.getElementById('tgHost'),
        port: document.getElementById('tgPort'),
        secret: document.getElementById('tgSecret'),
        dc: document.getElementById('tgDc'),
        cfEnabled: document.getElementById('tgCfEnabled'),
        cfDomainEnabled: document.getElementById('tgCfDomainEnabled'),
        cfDomain: document.getElementById('tgCfDomain')
    };
}

function parseDcLines(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
}

function getTgDraft() {
    const el = tgInputs();
    if (!el.host) return null;
    return {
        host: el.host.value.trim(),
        port: el.port.value.trim(),
        dc: parseDcLines(el.dc.value),
        cfEnabled: el.cfEnabled.checked,
        cfDomain: el.cfDomainEnabled.checked ? el.cfDomain.value.trim() : ''
    };
}

function isTgDirty() {
    if (tgSnapshot === null) return false;
    const draft = getTgDraft();
    return draft !== null && JSON.stringify(draft) !== tgSnapshot;
}

function updateTgDirtyNote() {
    const el = tgInputs();
    if (el.cfDomain && el.cfDomainEnabled) {
        el.cfDomain.disabled = !el.cfDomainEnabled.checked;
    }
    const note = document.getElementById('tgDirtyNote');
    const btn = document.getElementById('btnSaveTg');
    const dirty = isTgDirty();
    if (note) note.textContent = dirty ? t('tg.dirty_pending') : t('tg.dirty_none');
    if (btn) btn.classList.toggle('disabled', !dirty || isLoading);
}

function renderTgCard() {
    const el = tgInputs();
    if (!el.host || !tgConfig) return;

    // Preserve fields the user is editing; only repopulate when in sync.
    if (tgSnapshot === null || !isTgDirty()) {
        el.host.value = tgConfig.host || '';
        el.port.value = tgConfig.port || '';
        el.secret.value = tgConfig.secret || '';
        el.dc.value = (tgConfig.dc_redirects || []).join('\n');
        el.cfEnabled.checked = tgConfig.cf_enabled !== false;
        const dom = tgConfig.cf_domain || '';
        el.cfDomainEnabled.checked = Boolean(dom);
        el.cfDomain.value = dom;
        tgSnapshot = JSON.stringify(getTgDraft());
    }
    updateTgDirtyNote();
}

async function loadTgConfig(force = false) {
    if (tgRequestInFlight) return;
    if (tgLoaded && !force) {
        renderTgCard();
        return;
    }
    tgRequestInFlight = true;
    try {
        const res = await exec(`${CLI} tg status --json`);
        const payload = matchJson(res);
        if (!payload) return;
        tgConfig = JSON.parse(payload);
        tgLoaded = true;
        renderTgCard();
    } catch (error) {
        console.error('Telegram config load error:', error);
    } finally {
        tgRequestInFlight = false;
    }
}

async function saveTgSettings() {
    if (isLoading || !tgConfig || !isTgDirty()) return;

    const draft = getTgDraft();
    if (!draft) return;

    if (!draft.host) {
        showToast('tg.invalid_host');
        return;
    }
    if (!/^\d+$/.test(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65535) {
        showToast('tg.invalid_port');
        return;
    }
    for (const line of draft.dc) {
        if (!/^\d+:\d{1,3}(\.\d{1,3}){3}$/.test(line)) {
            showToast('tg.invalid_dc', { line });
            return;
        }
    }
    if (draft.cfDomain && !isValidPrivateDnsHostname(draft.cfDomain)) {
        showToast('tg.invalid_domain');
        return;
    }

    const prev = tgConfig;
    const cmds = [];
    if (draft.host !== prev.host) cmds.push(`tg set host ${shellQuote(draft.host)}`);
    if (draft.port !== String(prev.port)) cmds.push(`tg set port ${shellQuote(draft.port)}`);
    if (draft.dc.join('\n') !== (prev.dc_redirects || []).join('\n')) {
        cmds.push(`tg set dc ${shellQuote(draft.dc.join('\n'))}`);
    }
    if (draft.cfEnabled !== (prev.cf_enabled !== false)) {
        cmds.push(`tg set cf ${draft.cfEnabled ? 'on' : 'off'}`);
    }
    if (draft.cfDomain !== (prev.cf_domain || '')) {
        cmds.push(`tg set cf-domain ${shellQuote(draft.cfDomain)}`);
    }

    if (!cmds.length) {
        tgSnapshot = JSON.stringify(draft);
        updateTgDirtyNote();
        return;
    }

    const shouldRestart = Boolean(currentStatus && currentStatus.active);
    isLoading = true;
    setUiLocked(true, shouldRestart ? 'tg.saving_restart' : 'tg.saving');
    await waitForPaint();

    try {
        for (const cmd of cmds) {
            const res = await exec(`${CLI} ${cmd}`);
            if (res.errno !== 0) throw new Error(combineOutput(res) || cmd);
        }
        if (shouldRestart) {
            const res = await exec(`${CLI} restart`);
            if (res.errno !== 0) throw new Error(combineOutput(res) || 'restart failed');
        }
        tgSnapshot = null;
        await loadTgConfig(true);
        await Promise.all([refreshStatus(true), refreshActiveLogView()]);
        showToast(shouldRestart ? 'tg.saved_restart' : 'tg.saved');
    } catch (error) {
        showToast('generic.error_with_message', { message: error.message });
    } finally {
        isLoading = false;
        setUiLocked(false);
        renderRuntimePageUi();
        renderToolsPageUi();
    }
}

async function regenerateTgSecret() {
    if (isLoading) return;
    const shouldRestart = Boolean(currentStatus && currentStatus.active);

    const res = await runCli('tg regen-secret', {
        loadingKey: 'tg.regenerating',
        refresh: false
    });
    if (!res.ok) return;

    if (shouldRestart) {
        const rr = await runCli('restart', { loadingKey: 'tg.saving_restart', refresh: false });
        if (!rr.ok) return;
    }
    tgSnapshot = null;
    await loadTgConfig(true);
    await refreshStatus(true);
    showToast('tg.secret_regenerated');
}

async function testCfProxy() {
    if (isLoading) return;
    const btn = document.getElementById('btnTgCfTest');
    if (btn) btn.classList.add('loading');
    try {
        setUiLocked(true, 'tg.cf_testing');
        await waitForPaint();
        const res = await exec(`${CLI} tg cf-test --json`);
        const payload = matchJson(res);
        if (payload) {
            const result = JSON.parse(payload);
            if (result.ok) {
                showToast('tg.cf_test_ok', { domain: result.domain });
            } else {
                showToast('tg.cf_test_fail', { error: result.error || '' });
            }
        } else {
            showToast('tg.cf_test_fail', { error: combineOutput(res) });
        }
    } catch (error) {
        showToast('tg.cf_test_fail', { error: error.message });
    } finally {
        if (btn) btn.classList.remove('loading');
        setUiLocked(false);
    }
}

async function openInTelegram() {
    if (isLoading) return;
    await runCli('tg open', {
        loadingKey: 'tg.opening',
        successKey: 'tg.opened',
        refresh: false
    });
}

async function copyTgLink() {
    if (!tgConfig || !tgConfig.link) {
        showToast('tg.copy_failed');
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(tgConfig.link);
        } else {
            const ta = document.createElement('textarea');
            ta.value = tgConfig.link;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        showToast('tg.copied');
    } catch (error) {
        showToast('tg.copy_failed');
    }
}

function setupTgCard() {
    ['tgHost', 'tgPort', 'tgDc', 'tgCfDomain'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.dataset.bound !== '1') {
            el.dataset.bound = '1';
            el.addEventListener('input', updateTgDirtyNote);
        }
    });
    ['tgCfEnabled', 'tgCfDomainEnabled'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.dataset.bound !== '1') {
            el.dataset.bound = '1';
            el.addEventListener('change', updateTgDirtyNote);
        }
    });
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
window.setPrivateDnsMode = setPrivateDnsMode;
window.setPrivateDnsDefault = setPrivateDnsDefault;
window.applyPrivateDnsHostname = applyPrivateDnsHostname;
window.reloadUserList = reloadUserList;
window.addUserListDomain = addUserListDomain;
window.saveUserList = saveUserList;
window.saveTgSettings = saveTgSettings;
window.regenerateTgSecret = regenerateTgSecret;
window.testCfProxy = testCfProxy;
window.openInTelegram = openInTelegram;
window.copyTgLink = copyTgLink;
window.setLogView = setLogView;
window.clearEventsLog = clearEventsLog;
window.runDiagnose = runDiagnose;
window.toggleDiagnosticsDetails = toggleDiagnosticsDetails;
window.clearDiagnostics = clearDiagnostics;
window.jumpToBottom = jumpToBottom;

setupLocaleControls();
setupScrollTracking();
setupUserListEditor();
setupPrivateDnsControls();
setupTgCard();
rerenderAppUi();
renderPages();
refreshStatus();
