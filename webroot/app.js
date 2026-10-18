import { exec } from './kernelsu.js';
import { CLI, MODDIR, matchJson, combineOutput } from './cli.js';
import {
    esc,
    isPaneNearBottom,
    isValidHostname,
    parseLines,
    scrollPaneToBottom,
    setButtonDisabled,
    setPaneScrollTop,
    shellQuote,
    updatePaneContent,
    waitForPaint
} from './utils.js';
import {
    applyStaticTranslations,
    formatNumber,
    getLocale,
    hasMessage,
    initializeLocale,
    setLocale,
    t,
    tc
} from './i18n.js';

const LOG_POLL_MS = 3000;
const EVENTS_POLL_MS = 5000;
const TOAST_MS = 2500;
const FALLBACK_DNS_HOSTNAME = 'geohide.ru';
const PAGE_VIEWS = {
    overview: { pageId: 'pageOverview', buttonId: 'btnPageOverview' },
    domains: { pageId: 'pageDomains', buttonId: 'btnPageDomains' },
    telegram: { pageId: 'pageTelegram', buttonId: 'btnPageTelegram' },
    logs: { pageId: 'pageLogs', buttonId: 'btnPageLogs' }
};
// Text views tail a log file; the events view renders structured CLI output.
const LOG_VIEWS = {
    runtime: { paneId: 'runtimeLogPane', tabId: 'btnRuntimeTab', file: 'nzapret.log', metaKey: 'logs.runtime_meta' },
    nztg: { paneId: 'nztgLogPane', tabId: 'btnNztgTab', file: 'nztg.log', metaKey: 'logs.nztg_meta' },
    events: { paneId: 'eventsPane', tabId: 'btnEventsTab' }
};
const RUNTIME_ACTIONS = {
    start: { buttonId: 'btnPower', loadingKey: 'actions.starting' },
    stop: { buttonId: 'btnPower', loadingKey: 'actions.stopping' },
    restart: { buttonId: 'btnRestart', loadingKey: 'actions.restarting' },
    update: { buttonId: 'btnUpdate', loadingKey: 'actions.updating_data' }
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
    runtime: { text: '', loaded: false, scrolledUp: false },
    nztg: { text: '', loaded: false, scrolledUp: false },
    events: { items: [], lastPayload: '', scrolledUp: false }
};
let activePage = 'overview';
let activeLogView = 'runtime';
let currentStatus = null;
let statusViewState = 'checking';
let userListEntries = [];
let savedUserListEntries = [];
let userListLoaded = false;
let userListRequestInFlight = false;
let diagnosticsData = null;
let diagnosticsExpanded = false;
let privateDnsInputDirty = false;
let tgConfig = null;
let tgRequestInFlight = false;
let tgSnapshot = null;
let toastTimer = null;
let toastState = null;
let uiLockState = { locked: false, message: 'common.applying_changes', params: {} };

const $ = (id) => document.getElementById(id);

function setText(id, value) {
    $(id).textContent = value;
}

function isTextLog(view) {
    return Boolean(LOG_VIEWS[view].file);
}

function getLogPane(view) {
    return $(LOG_VIEWS[view].paneId);
}

// ---- Overlay lock and toast ----
function setUiLocked(locked, message = 'common.applying_changes', params = {}) {
    uiLockState = { locked, message, params };
    renderUiLock();
}

function renderUiLock() {
    setText('uiLockText', t(uiLockState.message, uiLockState.params));
    $('uiLock').classList.toggle('active', uiLockState.locked);
    document.body.classList.toggle('ui-busy', uiLockState.locked);
}

// Run `task` with the UI locked, then re-render both pages. Resolves to the
// task's result, or undefined when another operation already holds the lock.
async function withUiLock(loadingKey, loadingParams, task) {
    if (isLoading) return undefined;
    isLoading = true;
    setUiLocked(true, loadingKey, loadingParams);
    await waitForPaint();
    try {
        return await task();
    } finally {
        isLoading = false;
        setUiLocked(false);
        renderRuntimePageUi();
        renderToolsPageUi();
    }
}

function showToast(message, params = {}) {
    if (toastTimer) clearTimeout(toastTimer);
    toastState = { message, params };
    renderToast();
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => {
        $('toast').classList.remove('show');
        toastTimer = null;
        toastState = null;
    }, TOAST_MS);
}

function renderToast() {
    if (toastState) setText('toast', t(toastState.message, toastState.params));
}

// ---- Status card ----
function getPrivateDnsDefaultHostname(status = currentStatus) {
    return (status && status.private_dns_default_hostname) || FALLBACK_DNS_HOSTNAME;
}

function getStatusLabel() {
    if (!currentStatus) {
        return t(statusViewState === 'checking' ? 'status.checking' : 'status.error');
    }
    if (!currentStatus.active) return t('status.inactive');
    return parseInt(currentStatus.pid_count || 0, 10) > 1 ? t('status.multi_pid') : t('status.active');
}

// Mirrors the CLI's private_dns detail codes.
function getPrivateDnsStatusCode(status = currentStatus) {
    if (!status) return 'initial';
    if (status.private_dns_available === false) return 'unavailable';
    if (status.private_dns_mode === 'off') return 'off';
    if (status.private_dns_mode !== 'hostname') return 'auto';
    if (!status.private_dns_hostname) return 'hostname_unspecified';
    return status.private_dns_hostname === getPrivateDnsDefaultHostname(status) ? 'hostname_default' : 'hostname_custom';
}

function getPrivateDnsDisplayLabel(status = currentStatus) {
    switch (getPrivateDnsStatusCode(status)) {
        case 'initial': return '--';
        case 'unavailable': return t('private_dns.unavailable_short');
        case 'off': return t('private_dns.mode_off');
        case 'auto': return t('private_dns.mode_auto');
        default: return status.private_dns_hostname || t('private_dns.mode_provider');
    }
}

function getPrivateDnsNote(status = currentStatus) {
    const defaultHost = getPrivateDnsDefaultHostname(status);
    const hostname = (status && status.private_dns_hostname) || defaultHost;

    switch (getPrivateDnsStatusCode(status)) {
        case 'unavailable': return t('private_dns.status_unavailable');
        case 'off': return t('private_dns.status_off');
        case 'hostname_default': return t('private_dns.status_default_active', { hostname });
        case 'hostname_custom': return t('private_dns.status_custom_active', { hostname });
        case 'hostname_unspecified': return t('private_dns.status_custom_unspecified');
        case 'auto':
            return status.private_dns_initialized === false
                ? t('private_dns.status_init_pending', { default_hostname: defaultHost })
                : t('private_dns.status_auto');
        default: return t('private_dns.status_initial');
    }
}

// checking | error | on | warn (several nfqws2 PIDs) | off
function getStatusState(status = currentStatus) {
    if (!status) return statusViewState === 'checking' ? 'checking' : 'error';
    if (!status.active) return 'off';
    return parseInt(status.pid_count || 0, 10) > 1 ? 'warn' : 'on';
}

function renderTgStatus(status) {
    const active = Boolean(status && status.tg_active);
    const port = (status && status.tg_port) || '1443';
    $('tgConnectCard').dataset.state = !status ? 'unknown' : (active ? 'on' : 'off');
    setText('tgPageStatus', !status
        ? '--'
        : t(active ? 'tg.status_on' : 'tg.status_off', { port }));
    setText('tgStatusValue', !status
        ? '--'
        : (active ? t(status.tg_cf_enabled ? 'status.tg_port_cf' : 'status.tg_port', { port }) : t('status.off')));
}

function renderStatusCard() {
    const status = currentStatus;

    $('statusCard').dataset.state = getStatusState(status);
    setText('statusLabel', getStatusLabel());
    renderTgStatus(status);

    if (!status) {
        setText('pidBadge', 'nfqws2 --');
        setText('tgPidBadge', 'nztg --');
        setText('privateDnsLabel', '--');
        ['rulesV4', 'rulesV6', 'domainCount', 'googleDomainCount', 'userDomainCount']
            .forEach((id) => setText(id, '?'));
        return;
    }

    const pid = status.pid || '--';
    const pidCount = parseInt(status.pid_count || 0, 10);
    setText('version', status.version || t('common.unknown'));
    setText('pidBadge', pidCount > 1 ? `nfqws2 ${pid} +${pidCount - 1}` : `nfqws2 ${pid}`);
    setText('tgPidBadge', `nztg ${status.tg_pid || '--'}`);
    setText('privateDnsLabel', getPrivateDnsDisplayLabel(status));
    setText('rulesV4', status.rules_v4 ?? 0);
    setText('rulesV6', status.rules_v6 ?? 0);
    setText('domainCount', formatNumber(status.domain_count ?? 0));
    setText('googleDomainCount', formatNumber(status.google_domain_count ?? 0));
    setText('userDomainCount', formatNumber(status.user_domain_count ?? 0));
}

function renderRuntimeActionButtons() {
    if (isLoading) return;
    const isOn = isServiceOn();
    const power = $('btnPower');
    power.dataset.state = isOn ? 'on' : 'off';
    power.setAttribute('aria-label', t(isOn ? 'actions.stop' : 'actions.start'));
    power.title = power.getAttribute('aria-label');
    setButtonDisabled($('btnRestart'), !isOn);
    setButtonDisabled($('btnUpdate'), false);
}

function isServiceOn() {
    return Boolean(currentStatus && currentStatus.active);
}

function togglePower() {
    return doAction(isServiceOn() ? 'stop' : 'start');
}

function renderRuntimePageUi() {
    renderStatusCard();
    renderRuntimeActionButtons();
}

function renderToolsPageUi() {
    renderPrivateDnsControls();
    updateUserListEditorState();
    renderTgCard();
    renderDiagnoseButton();
    renderDiagnosticsPanel();
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
        currentStatus = null;
        statusViewState = 'unavailable';
        renderRuntimePageUi();
        renderToolsPageUi();
        if (!hasShownStatusError) {
            showToast('status.refresh_failed');
            hasShownStatusError = true;
        }
        console.error('Status refresh error:', error);
    } finally {
        statusRequestInFlight = false;
    }
}

async function runCli(args, options = {}) {
    const {
        loadingKey = 'common.applying_changes',
        loadingParams = {},
        successKey = '',
        successParams = {},
        refresh = true
    } = options;

    const result = await withUiLock(loadingKey, loadingParams, async () => {
        try {
            const res = await exec(`${CLI} ${args}`);
            const output = combineOutput(res);
            if (res.errno !== 0) {
                showToast('generic.error_with_message', { message: output || args });
                return { ok: false, output };
            }
            if (successKey) showToast(successKey, successParams);
            if (refresh) await Promise.all([refreshStatus(true), refreshActiveLogView()]);
            return { ok: true, output };
        } catch (error) {
            const message = error.message || String(error);
            showToast('generic.error_with_message', { message });
            return { ok: false, output: message };
        }
    });
    return result || { ok: false, skipped: true };
}

async function doAction(command) {
    const action = RUNTIME_ACTIONS[command];
    const button = action ? $(action.buttonId) : null;
    if (button && button.classList.contains('disabled')) return;
    if (button) button.classList.add('loading');

    await runCli(command, {
        loadingKey: action ? action.loadingKey : 'common.applying_changes',
        successKey: 'actions.completed',
        successParams: { command: action ? t(`actions.${command}`) : command }
    });

    if (button) button.classList.remove('loading');
}

// ---- Private DNS ----
function renderPrivateDnsControls(status = currentStatus) {
    const note = $('privateDnsNote');
    const input = $('privateDnsHostnameInput');
    const defaultHost = getPrivateDnsDefaultHostname(status);
    const mode = (status && status.private_dns_mode) || '';
    const hostname = (status && status.private_dns_hostname) || '';
    const unavailable = Boolean(status && status.private_dns_available === false);
    const controlsDisabled = isLoading || !status || unavailable;
    const activeByMode = {
        off: mode === 'off',
        auto: mode === 'opportunistic',
        default: mode === 'hostname' && hostname === defaultHost
    };

    note.textContent = getPrivateDnsNote(status);
    note.classList.toggle('warning', unavailable);

    if (!privateDnsInputDirty && document.activeElement !== input) {
        input.value = hostname || defaultHost;
    }
    input.placeholder = defaultHost;
    setText('privateDnsDefaultLabel', defaultHost);

    document.querySelectorAll('[data-private-dns-mode]').forEach((button) => {
        button.classList.toggle('active', Boolean(activeByMode[button.dataset.privateDnsMode]));
        setButtonDisabled(button, controlsDisabled);
    });
    setButtonDisabled($('btnApplyPrivateDnsHostname'), controlsDisabled || !isValidHostname(input.value));
}

function canChangePrivateDns() {
    return !isLoading && currentStatus && currentStatus.private_dns_available !== false;
}

async function applyPrivateDns(args, loadingKey, loadingParams = {}) {
    const result = await runCli(`dns set ${args}`, {
        loadingKey,
        loadingParams,
        successKey: 'private_dns.updated'
    });
    if (result.ok) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls();
    }
}

async function setPrivateDnsMode(mode) {
    if (!canChangePrivateDns()) return;
    const currentMode = currentStatus.private_dns_mode || '';
    if ((mode === 'off' && currentMode === 'off') || (mode === 'auto' && currentMode === 'opportunistic')) {
        return;
    }
    await applyPrivateDns(shellQuote(mode), mode === 'off' ? 'private_dns.loading_disable' : 'private_dns.loading_auto');
}

async function setPrivateDnsDefault() {
    if (!canChangePrivateDns()) return;
    const hostname = getPrivateDnsDefaultHostname();
    if (currentStatus.private_dns_mode === 'hostname' && currentStatus.private_dns_hostname === hostname) {
        return;
    }
    await applyPrivateDns('default', 'private_dns.loading_default', { hostname });
}

async function applyPrivateDnsHostname() {
    if (!canChangePrivateDns()) return;

    const hostname = $('privateDnsHostnameInput').value.trim().toLowerCase();
    if (!isValidHostname(hostname)) {
        showToast('private_dns.invalid_hostname');
        renderPrivateDnsControls();
        return;
    }
    if (currentStatus.private_dns_mode === 'hostname' && currentStatus.private_dns_hostname === hostname) {
        privateDnsInputDirty = false;
        renderPrivateDnsControls();
        return;
    }
    await applyPrivateDns(`hostname ${shellQuote(hostname)}`, 'private_dns.loading_hostname');
}

function setupPrivateDnsControls() {
    const input = $('privateDnsHostnameInput');
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
}

// ---- Personal domain list ----
function isUserListBusy() {
    return isLoading || userListRequestInFlight;
}

function renderUserListPane() {
    const pane = $('userListPane');
    const busy = isUserListBusy();
    const saved = new Set(savedUserListEntries);

    pane.classList.toggle('empty', !userListEntries.length);
    if (!userListEntries.length) {
        pane.innerHTML = `<div class="domain-empty">${esc(t('user_list.empty'))}</div>`;
        return;
    }

    const removeLabel = esc(t('common.remove_domain'));
    const newTag = esc(t('user_list.new_tag'));
    pane.innerHTML = userListEntries.map((domain) => {
        const pending = !saved.has(domain);
        return `
        <div class="domain-row${pending ? ' pending' : ''}">
            <span class="domain-dot"></span>
            <span class="domain-name">${esc(domain)}</span>
            ${pending ? `<span class="domain-tag">${newTag}</span>` : ''}
            <button
                class="icon-btn ghost${busy ? ' disabled' : ''}"
                type="button"
                data-remove-domain="${esc(domain)}"
                aria-label="${removeLabel}"
                title="${removeLabel}"
                ${busy ? 'disabled' : ''}
            >
                <svg class="i" aria-hidden="true"><use href="#i-x"/></svg>
            </button>
        </div>`;
    }).join('');
}

// Only the Add button depends on the quick-add input, so typing does not
// rebuild the whole domain pane.
function updateUserListAddButton() {
    const hasPendingInput = Boolean($('userListQuickInput').value.trim());
    setButtonDisabled($('btnAddUserListDomain'), isUserListBusy() || !hasPendingInput);
}

function isUserListDirty() {
    return userListEntries.join('\n') !== savedUserListEntries.join('\n');
}

function updateUserListEditorState() {
    const isDirty = isUserListDirty();
    const attached = currentStatus && typeof currentStatus.user_list_attached === 'boolean'
        ? currentStatus.user_list_attached
        : null;
    const bindingKey = attached === null
        ? 'user_list.binding_unknown'
        : (attached ? 'user_list.binding_applied' : 'user_list.binding_missing');

    setText('userListCountBadge', tc('counts.domains', userListEntries.length));
    setText('userListDirtyNote', t('user_list.dirty_unsaved'));
    $('userListSaveBar').hidden = !isDirty;
    setText('userListBindingNote', t(bindingKey));
    $('userListBindingNote').classList.toggle('warning', attached === false);

    renderUserListPane();
    setButtonDisabled($('btnSaveUserList'), isUserListBusy() || !isDirty);
    setButtonDisabled($('btnReloadUserList'), isUserListBusy());
    updateUserListAddButton();
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
        userListEntries = parseLines(res.stdout);
        savedUserListEntries = userListEntries.slice();
        $('userListQuickInput').value = '';
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
    if (isUserListBusy()) return;
    if (await loadUserList(true)) {
        showToast('user_list.reloaded');
    }
}

function addUserListDomain() {
    if (isUserListBusy()) return;

    const quickInput = $('userListQuickInput');
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
    if (isUserListBusy() || !userListEntries.includes(domain)) return;
    userListEntries = userListEntries.filter((entry) => entry !== domain);
    updateUserListEditorState();
}

async function saveUserList() {
    if (isUserListBusy()) return;

    const entries = userListEntries.slice();
    const result = await runCli(
        entries.length ? `list-user replace ${entries.map(shellQuote).join(' ')}` : 'list-user clear',
        {
            loadingKey: entries.length ? 'user_list.saving' : 'user_list.clearing',
            successKey: entries.length ? 'user_list.saved' : 'user_list.cleared'
        }
    );
    if (result.ok) {
        await loadUserList(true);
    }
}

function setupUserListEditor() {
    const quickInput = $('userListQuickInput');
    quickInput.addEventListener('input', updateUserListAddButton);
    quickInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addUserListDomain();
        }
    });
    $('userListPane').addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-domain]');
        if (button) removeUserListDomain(button.getAttribute('data-remove-domain') || '');
    });
}

// ---- Telegram proxy (nztgproxy) ----
function tgInputs() {
    return {
        host: $('tgHost'),
        port: $('tgPort'),
        secret: $('tgSecret'),
        dc: $('tgDc'),
        cfEnabled: $('tgCfEnabled'),
        cfDomainEnabled: $('tgCfDomainEnabled'),
        cfDomain: $('tgCfDomain'),
        preResolve: $('tgPreresolve')
    };
}

function getTgDraft() {
    const el = tgInputs();
    return {
        host: el.host.value.trim(),
        port: el.port.value.trim(),
        dc: parseLines(el.dc.value),
        cfEnabled: el.cfEnabled.checked,
        cfDomain: el.cfDomainEnabled.checked ? el.cfDomain.value.trim() : '',
        preResolve: el.preResolve.checked
    };
}

function isTgDirty() {
    return tgSnapshot !== null && JSON.stringify(getTgDraft()) !== tgSnapshot;
}

function updateTgDirtyNote() {
    const el = tgInputs();
    const dirty = isTgDirty();
    el.cfDomain.disabled = !el.cfDomainEnabled.checked;
    setText('tgDirtyNote', t('tg.dirty_pending'));
    $('tgSaveBar').hidden = !dirty;
    setButtonDisabled($('btnSaveTg'), !dirty || isLoading);
}

function renderTgCard() {
    if (!tgConfig) return;

    // Preserve fields the user is editing; only repopulate when in sync.
    if (!isTgDirty()) {
        const el = tgInputs();
        el.host.value = tgConfig.host || '';
        el.port.value = tgConfig.port || '';
        el.secret.value = tgConfig.secret || '';
        el.dc.value = (tgConfig.dc_redirects || []).join('\n');
        el.cfEnabled.checked = tgConfig.cf_enabled !== false;
        el.cfDomainEnabled.checked = Boolean(tgConfig.cf_domain);
        el.cfDomain.value = tgConfig.cf_domain || '';
        el.preResolve.checked = tgConfig.preresolve_enabled !== false;
        tgSnapshot = JSON.stringify(getTgDraft());
    }
    updateTgDirtyNote();
}

async function loadTgConfig(force = false) {
    if (tgRequestInFlight) return;
    if (tgConfig && !force) {
        renderTgCard();
        return;
    }
    tgRequestInFlight = true;
    try {
        const payload = matchJson(await exec(`${CLI} tg status --json`));
        if (!payload) return;
        tgConfig = JSON.parse(payload);
        renderTgCard();
    } catch (error) {
        console.error('Telegram config load error:', error);
    } finally {
        tgRequestInFlight = false;
    }
}

// Returns an i18n error [key, params] for an invalid draft, or null.
function validateTgDraft(draft) {
    if (!draft.host || /\s/.test(draft.host)) return ['tg.invalid_host'];
    const port = Number(draft.port);
    if (!/^\d+$/.test(draft.port) || port < 1 || port > 65535) return ['tg.invalid_port'];
    const badLine = draft.dc.find((line) => !/^\d+:\d{1,3}(\.\d{1,3}){3}$/.test(line));
    if (badLine) return ['tg.invalid_dc', { line: badLine }];
    if (draft.cfDomain && !isValidHostname(draft.cfDomain)) return ['tg.invalid_domain'];
    return null;
}

// CLI `tg set` commands for the fields that differ from the loaded config.
function getTgChangeCommands(draft, prev) {
    const switchArg = (value) => (value ? 'on' : 'off');
    const cmds = [];
    if (draft.host !== prev.host) cmds.push(`tg set host ${shellQuote(draft.host)}`);
    if (draft.port !== String(prev.port)) cmds.push(`tg set port ${shellQuote(draft.port)}`);
    if (draft.dc.join('\n') !== (prev.dc_redirects || []).join('\n')) {
        cmds.push(`tg set dc ${shellQuote(draft.dc.join('\n'))}`);
    }
    if (draft.cfEnabled !== (prev.cf_enabled !== false)) cmds.push(`tg set cf ${switchArg(draft.cfEnabled)}`);
    if (draft.cfDomain !== (prev.cf_domain || '')) cmds.push(`tg set cf-domain ${shellQuote(draft.cfDomain)}`);
    if (draft.preResolve !== (prev.preresolve_enabled !== false)) {
        cmds.push(`tg set preresolve ${switchArg(draft.preResolve)}`);
    }
    return cmds;
}

async function saveTgSettings() {
    if (isLoading || !tgConfig || !isTgDirty()) return;

    const draft = getTgDraft();
    const invalid = validateTgDraft(draft);
    if (invalid) {
        showToast(...invalid);
        return;
    }

    const cmds = getTgChangeCommands(draft, tgConfig);
    if (!cmds.length) {
        tgSnapshot = JSON.stringify(draft);
        updateTgDirtyNote();
        return;
    }

    const shouldRestart = Boolean(currentStatus && currentStatus.active);
    try {
        await withUiLock(shouldRestart ? 'tg.saving_restart' : 'tg.saving', {}, async () => {
            if (shouldRestart) cmds.push('restart');
            for (const cmd of cmds) {
                const res = await exec(`${CLI} ${cmd}`);
                if (res.errno !== 0) throw new Error(combineOutput(res) || cmd);
            }
            tgSnapshot = null;
            await loadTgConfig(true);
            await Promise.all([refreshStatus(true), refreshActiveLogView()]);
            showToast(shouldRestart ? 'tg.saved_restart' : 'tg.saved');
        });
    } catch (error) {
        showToast('generic.error_with_message', { message: error.message });
    }
}

async function regenerateTgSecret() {
    if (isLoading) return;
    const shouldRestart = Boolean(currentStatus && currentStatus.active);

    if (!(await runCli('tg regen-secret', { loadingKey: 'tg.regenerating', refresh: false })).ok) return;
    if (shouldRestart && !(await runCli('restart', { loadingKey: 'tg.saving_restart', refresh: false })).ok) return;

    tgSnapshot = null;
    await loadTgConfig(true);
    await refreshStatus(true);
    showToast('tg.secret_regenerated');
}

async function testCfProxy() {
    if (isLoading) return;
    const button = $('btnTgCfTest');
    button.classList.add('loading');
    try {
        await withUiLock('tg.cf_testing', {}, async () => {
            const res = await exec(`${CLI} tg cf-test --json`);
            const payload = matchJson(res);
            const result = payload ? JSON.parse(payload) : { ok: false, error: combineOutput(res) };
            if (result.ok) {
                showToast('tg.cf_test_ok', { domain: result.domain });
            } else {
                showToast('tg.cf_test_fail', { error: result.error || '' });
            }
        });
    } catch (error) {
        showToast('tg.cf_test_fail', { error: error.message });
    } finally {
        button.classList.remove('loading');
    }
}

async function openInTelegram() {
    if (isLoading) return;
    await runCli('tg open', { loadingKey: 'tg.opening', successKey: 'tg.opened', refresh: false });
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
        $(id).addEventListener('input', updateTgDirtyNote);
    });
    ['tgCfEnabled', 'tgCfDomainEnabled', 'tgPreresolve'].forEach((id) => {
        $(id).addEventListener('change', updateTgDirtyNote);
    });
}

// ---- Diagnostics ----
function renderDiagnoseButton() {
    const button = $('btnDiagnose');
    const loading = button.classList.contains('loading');
    button.querySelector('.btn-label').textContent = t(loading ? 'diagnostics.running' : 'diagnostics.run');
}

function setDiagnoseButtonLoading(loading) {
    $('btnDiagnose').classList.toggle('loading', loading);
    renderDiagnoseButton();
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
        case 'routing':
            return t(check.family === 'ipv6' ? 'diagnostics.names.routing_ipv6' : 'diagnostics.names.routing_ipv4');
        case 'userlist_binding':
        case 'ip_stack':
        case 'private_dns':
            return t(`diagnostics.names.${check.code}`);
        case 'jump_rule':
            return check.table && check.hook ? `${check.table} ${check.hook}` : (check.name || '');
        default:
            return check.subject || check.name || '';
    }
}

// Translations are keyed by the CLI's code/detail_code; unknown pairs fall
// back to the CLI's English detail text.
function getLocalizedDiagnoseDetail(check) {
    const key = `diagnostics.details.${check.code}.${check.detail_code}`;
    if (!check.code || !check.detail_code || !hasMessage(key)) {
        return check.detail || '';
    }
    return t(key, {
        pid: check.pid || '?',
        hostname: check.hostname || check.default_hostname || getPrivateDnsDefaultHostname()
    });
}

function renderDiagnosticsPanel() {
    const results = $('diagResults');
    const checklistShell = $('diagChecklistShell');
    const checklist = $('diagChecklist');
    const summary = $('diagSummary');

    $('diagEmptyState').hidden = Boolean(diagnosticsData);
    results.hidden = !diagnosticsData;
    if (!diagnosticsData) {
        checklistShell.hidden = true;
        checklist.innerHTML = '';
        summary.innerHTML = '';
        return;
    }

    const counts = diagnosticsData.summary || { ok: 0, fail: 0, total: 0 };
    const checks = diagnosticsData.checks || [];
    const allOk = !counts.fail;
    const toggleLabel = t(diagnosticsExpanded ? 'diagnostics.hide_details' : 'diagnostics.show_details');
    const clearLabel = esc(t('common.clear'));

    summary.innerHTML = `
        <div class="diag-score">
            <span class="diag-score-value ${allOk ? 'ok' : 'fail'}">${esc(formatNumber(counts.ok))}/${esc(formatNumber(counts.total))}</span>
            <span class="diag-score-text">${esc(allOk ? t('diagnostics.summary_all_ok') : t('diagnostics.summary_failed', { fail: formatNumber(counts.fail) }))}</span>
        </div>
        <div class="diag-summary-actions">
            <button class="btn btn-ghost btn-sm" type="button" onclick="toggleDiagnosticsDetails()">${esc(toggleLabel)}</button>
            <button class="icon-btn ghost" type="button" onclick="clearDiagnostics()" aria-label="${clearLabel}" title="${clearLabel}">
                <svg class="i" aria-hidden="true"><use href="#i-x"/></svg>
            </button>
        </div>
    `;

    checklistShell.hidden = !diagnosticsExpanded;
    checklist.innerHTML = !diagnosticsExpanded ? '' : checks.map((check) => `
        <div class="diag-item">
            <span class="diag-icon ${check.status === 'ok' ? 'ok' : 'fail'}"><svg class="i" aria-hidden="true"><use href="#i-${check.status === 'ok' ? 'check' : 'x'}"/></svg></span>
            <span class="diag-name">${esc(getLocalizedDiagnoseName(check))}</span>
            <span class="diag-detail">${esc(getLocalizedDiagnoseDetail(check))}</span>
        </div>
    `).join('');
}

async function runDiagnose() {
    if (isLoading || $('btnDiagnose').classList.contains('loading')) return;
    setDiagnoseButtonLoading(true);

    try {
        await withUiLock('diagnostics.overlay_running', {}, async () => {
            const payload = matchJson(await exec(`${CLI} diagnose --json`));
            if (!payload) {
                showToast('diagnostics.failed');
                return;
            }
            diagnosticsData = JSON.parse(payload);
            diagnosticsExpanded = false;
            showToast('diagnostics.completed');
        });
    } catch (error) {
        showToast('diagnostics.error', { message: error.message });
    } finally {
        setDiagnoseButtonLoading(false);
        renderDiagnosticsPanel();
    }
}

// ---- Logs ----
function syncLogPaneScroll(view, pane, previousScrollTop, forceBottom = false) {
    const state = logState[view];
    if (forceBottom || isPaneNearBottom(pane) || !state.scrolledUp) {
        scrollPaneToBottom(pane);
        state.scrolledUp = false;
    } else {
        setPaneScrollTop(pane, previousScrollTop);
    }
}

function updateLogMeta() {
    const meta = $('logMeta');
    if (isTextLog(activeLogView)) {
        meta.textContent = t(LOG_VIEWS[activeLogView].metaKey);
    } else {
        const count = logState.events.items.length;
        meta.textContent = count ? tc('counts.events', count) : t('logs.event_history');
    }
}

function updateStatusBar() {
    const textView = isTextLog(activeLogView);
    const isLive = textView && logInterval !== null;
    $('logLiveLabel').hidden = !isLive;
    $('btnClearEvents').hidden = textView;

    if (textView) {
        const state = logState[activeLogView];
        const lines = state.text ? state.text.split('\n').length : 0;
        setText('logLineCount', state.loaded ? tc('counts.lines', lines) : '--');
        $('logJumpBtn').classList.toggle('visible', state.scrolledUp);
    } else {
        setText('logLineCount', tc('counts.entries', logState.events.items.length));
        $('logJumpBtn').classList.remove('visible');
    }
}

function renderEventsPane() {
    const pane = getLogPane('events');
    const previousScrollTop = pane.scrollTop;
    const { items } = logState.events;
    const markup = !items.length
        ? `<div class="events-empty">${esc(t('logs.events_empty'))}</div>`
        : items.map((evt) => `<div class="event-item">
            <div class="event-dot ${esc((evt.type || '').toLowerCase())}"></div>
            <div class="event-body">
                <div class="event-head">
                    <span class="event-type">${esc(evt.type)}</span>
                    <span class="event-time">${esc(evt.time ? evt.time.substring(11) : '')}</span>
                </div>
                <div class="event-msg">${esc(evt.message)}</div>
            </div>
        </div>`).join('');
    const changed = updatePaneContent(pane, markup, { html: true });

    if (!items.length) {
        logState.events.scrolledUp = false;
    } else if (changed) {
        syncLogPaneScroll('events', pane, previousScrollTop);
    }
}

async function refreshEvents() {
    if (eventsRequestInFlight) return;
    eventsRequestInFlight = true;
    try {
        const payload = matchJson(await exec(`${CLI} events --json --tail=50`), { array: true });
        if (!payload || payload === logState.events.lastPayload) return;
        logState.events.items = JSON.parse(payload);
        logState.events.lastPayload = payload;
        if (activeLogView === 'events') {
            renderEventsPane();
            updateLogMeta();
            updateStatusBar();
        }
    } catch (error) {
        console.error('Events refresh error:', error);
    } finally {
        eventsRequestInFlight = false;
    }
}

function renderTextLog(view, forceBottom = false) {
    const pane = getLogPane(view);
    const previousScrollTop = pane.scrollTop;
    const state = logState[view];
    const nextText = state.loaded ? (state.text || t('logs.runtime_empty')) : t('logs.loading_runtime');
    if (updatePaneContent(pane, nextText) || forceBottom) {
        syncLogPaneScroll(view, pane, previousScrollTop, forceBottom);
    }
}

async function refreshTextLog(view) {
    if (logRequestInFlight || !isTextLog(view) || activeLogView !== view) return;

    logRequestInFlight = true;
    try {
        const res = await exec(`tail -n 80 ${MODDIR}/${LOG_VIEWS[view].file} 2>/dev/null`);
        const state = logState[view];
        state.text = String(res.stdout || '').replace(/\r/g, '').trim();
        state.loaded = true;
        renderTextLog(view);
        updateStatusBar();
    } catch (error) {
        console.error('Log refresh error:', error);
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
        logState[view].scrolledUp = !isPaneNearBottom(getLogPane(view));
        updateStatusBar();
    }

    Object.keys(LOG_VIEWS).forEach((view) => {
        getLogPane(view).addEventListener('scroll', () => {
            pendingView = view;
            if (scrollFrame === null) {
                scrollFrame = requestAnimationFrame(flushScroll);
            }
        }, { passive: true });
    });
}

function jumpToBottom() {
    scrollPaneToBottom(getLogPane(activeLogView));
    logState[activeLogView].scrolledUp = false;
    updateStatusBar();
}

async function clearEventsLog() {
    if (activeLogView !== 'events' || isLoading) return;

    const button = $('btnClearEvents');
    button.classList.add('loading');
    try {
        await withUiLock('logs.clearing_events', {}, async () => {
            const res = await exec(`${CLI} events clear`);
            if (res.errno !== 0) {
                throw new Error(combineOutput(res) || 'events clear failed');
            }
            Object.assign(logState.events, { items: [], lastPayload: '[]', scrolledUp: false });
            renderEventsPane();
            updateLogMeta();
            updateStatusBar();
            showToast('logs.cleared_events');
            await refreshEvents();
        });
    } catch (error) {
        showToast('logs.clear_failed', { message: error.message });
    } finally {
        button.classList.remove('loading');
    }
}

function renderLogView() {
    Object.entries(LOG_VIEWS).forEach(([view, config]) => {
        $(config.paneId).classList.toggle('active', activeLogView === view);
        $(config.tabId).classList.toggle('active', activeLogView === view);
    });
    updateLogMeta();
    updateStatusBar();
}

function startLogPolling() {
    if (logInterval) clearInterval(logInterval);
    logInterval = setInterval(() => {
        if (!document.hidden) refreshTextLog(activeLogView);
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
        if (!document.hidden) refreshEvents();
    }, EVENTS_POLL_MS);
}

function stopEventsPolling() {
    if (eventsInterval) {
        clearInterval(eventsInterval);
        eventsInterval = null;
    }
}

function syncLogPolling() {
    const onLogs = activePage === 'logs' && !document.hidden;
    if (onLogs && isTextLog(activeLogView)) startLogPolling(); else stopLogPolling();
    if (onLogs && activeLogView === 'events') startEventsPolling(); else stopEventsPolling();
}

async function refreshActiveLogView() {
    if (activePage !== 'logs') return;

    if (!isTextLog(activeLogView)) {
        await refreshEvents();
        return;
    }
    if (!logState[activeLogView].loaded) {
        renderTextLog(activeLogView, true);
    }
    await refreshTextLog(activeLogView);
}

async function setLogView(view) {
    activeLogView = view;
    renderLogView();
    syncLogPolling();
    await refreshActiveLogView();
}

// ---- Pages and rendering ----
function renderPages() {
    Object.entries(PAGE_VIEWS).forEach(([page, config]) => {
        $(config.pageId).classList.toggle('active', activePage === page);
        $(config.buttonId).classList.toggle('active', activePage === page);
    });
    syncLogPolling();
}

async function refreshActivePageData(force = false) {
    if (activePage === 'domains') {
        // A forced refresh (app resume) must not discard unsaved edits.
        await loadUserList(force && !isUserListDirty());
    } else if (activePage === 'telegram') {
        await loadTgConfig(force);
    } else if (activePage === 'logs') {
        await refreshActiveLogView();
    }
}

async function setPage(page) {
    activePage = page;
    renderPages();
    await refreshActivePageData();
}

function rerenderNonLogUi() {
    applyStaticTranslations(document, { default_hostname: getPrivateDnsDefaultHostname() });
    document.querySelectorAll('[data-locale]').forEach((button) => {
        button.classList.toggle('active', button.dataset.locale === getLocale());
    });
    if (uiLockState.locked) renderUiLock();
    if ($('toast').classList.contains('show')) renderToast();
    renderRuntimePageUi();
    renderToolsPageUi();
}

function rerenderAppUi() {
    rerenderNonLogUi();
    renderTextLog('runtime');
    renderTextLog('nztg');
    renderEventsPane();
    renderLogView();
}

function setupLocaleControls() {
    document.querySelectorAll('[data-locale]').forEach((button) => {
        button.addEventListener('click', () => {
            setLocale(button.dataset.locale || 'ru');
            rerenderAppUi();
        });
    });
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        if (!isLoading) refreshStatus(true);
        refreshActivePageData(true);
    }
    syncLogPolling();
});

Object.assign(window, {
    doAction,
    togglePower,
    setPage,
    setPrivateDnsMode,
    setPrivateDnsDefault,
    applyPrivateDnsHostname,
    reloadUserList,
    addUserListDomain,
    saveUserList,
    saveTgSettings,
    regenerateTgSecret,
    testCfProxy,
    openInTelegram,
    copyTgLink,
    setLogView,
    clearEventsLog,
    runDiagnose,
    toggleDiagnosticsDetails,
    clearDiagnostics,
    jumpToBottom
});

setupLocaleControls();
setupScrollTracking();
setupUserListEditor();
setupPrivateDnsControls();
setupTgCard();
rerenderAppUi();
renderPages();
refreshStatus();
