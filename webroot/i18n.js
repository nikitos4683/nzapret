const DEFAULT_LOCALE = 'ru';
const FALLBACK_LOCALE = 'en';
const LOCALE_STORAGE_KEY = 'nzapret.webui.locale';
const SUPPORTED_LOCALES = ['ru', 'en'];

const translations = {
    ru: {
        aria: {
            sections: 'Разделы',
            language: 'Язык интерфейса'
        },
        nav: {
            runtime: 'Статус',
            tools: 'Настройки',
            logs: 'Логи'
        },
        common: {
            save: 'Сохранить',
            save_restart: 'Сохранить и перезапустить',
            reload: 'Обновить',
            add: 'Добавить',
            clear: 'Очистить',
            end: 'Вниз',
            live: 'LIVE',
            loading: 'Загрузка...',
            applying_changes: 'Применение изменений...',
            unknown: 'неизвестно',
            remove_domain: 'Удалить домен'
        },
        status: {
            checking: 'Проверка...',
            active: 'В работе',
            inactive: 'Остановлен',
            multi_pid: 'Несколько PID',
            error: 'Ошибка статуса',
            refresh_failed: 'Не удалось обновить статус',
            labels: {
                network_mode: 'Сетевой режим',
                private_dns: 'Частный DNS',
                domains: 'Домены',
                google_domains: 'Google домены',
                personal_domains: 'Личные домены',
                ipv4_rules: 'Правила IPv4',
                ipv6_rules: 'Правила IPv6'
            }
        },
        actions: {
            start: 'Старт',
            stop: 'Стоп',
            restart: 'Перезапуск',
            update: 'Обновить',
            starting: 'Запуск nzapret...',
            stopping: 'Остановка nzapret...',
            restarting: 'Перезапуск nzapret...',
            updating_data: 'Обновление данных...',
            completed: 'Команда {{command}} выполнена'
        },
        user_list: {
            title: 'Персональный список доменов',
            subtitle: 'Добавляйте или удаляйте домены, затем нажимайте «Сохранить». Кнопка «Обновить» восстанавливает сохранённый список с устройства, а nfqws2 подхватывает изменения hostlist без перезапуска.',
            empty: 'Персональный список пока пуст. Добавьте домен ниже, чтобы включить его в активный hostlist.',
            quick_placeholder: 'Введите домен и нажмите Добавить',
            dirty_none: 'Несохранённых изменений нет.',
            dirty_unsaved: 'Есть несохранённые изменения. Нажмите «Сохранить», чтобы применить их.',
            binding_applied: 'Используется текущей конфигурацией.',
            binding_missing: 'Текущая конфигурация пока не ссылается на list-user.txt.',
            binding_unknown: 'Статус конфигурации недоступен.',
            load_failed: 'Не удалось загрузить персональный список',
            reloaded: 'Персональный список обновлён',
            comments_not_added: 'Комментарии здесь не поддерживаются',
            already_exists: 'Домен уже есть в списке',
            saving: 'Сохранение персональных доменов...',
            clearing: 'Очистка персональных доменов...',
            saved: 'Персональный список сохранён',
            cleared: 'Персональный список очищен'
        },
        network: {
            title: 'Сетевой стек',
            subtitle: 'Выберите, должен ли nzapret держать перехват IPv6 активным или работать в отдельном режиме только для IPv4.',
            auto_label: 'Авто',
            auto_meta: 'Использовать IPv4 и держать IPv6 наготове, если он поддерживается сетью.',
            ipv4_only_label: 'Только IPv4',
            ipv4_only_meta: 'Не создавать правила ip6tables и IPv6 bind-fix при перезапуске.',
            dirty_none: 'Несохранённых изменений нет.',
            dirty_unsaved: 'Есть несохранённые изменения.',
            ipv6_unavailable: 'IPv6 недоступен. Включите IPv6 в настройках сети и вернитесь сюда.',
            ipv6_checking: 'Проверка доступности IPv6...',
            auto_requires_ipv6: 'Режим Авто требует активного IPv6-соединения',
            enable_ipv6_hint: 'Включите IPv6 в настройках сети и вернитесь сюда',
            saving: 'Сохранение сетевого режима...',
            saving_restart: 'Сохранение сетевого режима и перезапуск nzapret...',
            saved: 'Сетевой режим сохранён',
            saved_restart: 'Сетевой режим сохранён, nzapret перезапущен',
            saved_restart_failed: 'Сетевой режим сохранён, но перезапуск завершился с ошибкой',
            mode_ipv4_only: 'Только IPv4',
            mode_auto_dual: 'Авто (IPv4 + IPv6)',
            mode_auto_fallback: 'Авто (откат на IPv4)'
        },
        private_dns: {
            title: 'Частный DNS',
            subtitle_html: 'Управление Частным DNS в системе Android. При первом запуске службы nzapret автоматически установит <code>{{default_hostname}}</code>, если на устройстве ещё не задан другой DNS-провайдер.',
            off_label: 'Выкл',
            off_meta: 'Отключить Частный DNS для системного резолвера Android.',
            auto_label: 'Авто',
            auto_meta: 'Позволить Android использовать шифрованный DNS, если он поддерживается текущей сетью.',
            default_meta: 'Сразу применить провайдера по умолчанию для nzapret.',
            hostname_placeholder: 'dns.example.com',
            apply_hostname: 'Применить адрес',
            status_initial: 'Статус Частного DNS появится здесь после первого обновления.',
            status_unavailable: 'Управление Частным DNS недоступно, потому что в этой сборке Android отсутствует команда settings.',
            status_init_pending: 'При первом запуске службы nzapret выставит {{default_hostname}}, если уже не настроен другой DNS-провайдер.',
            status_off: 'Частный DNS отключён для системного резолвера Android.',
            status_default_active: '{{hostname}} активен как провайдер по умолчанию для nzapret. Изменения применяются сразу.',
            status_custom_active: 'Сейчас активен пользовательский провайдер {{hostname}}. Изменения применяются сразу.',
            status_custom_unspecified: 'Сейчас активен пользовательский адрес провайдера. Изменения применяются сразу.',
            status_auto: 'В автоматическом режиме Android использует шифрованный DNS, если он поддерживается текущей сетью. Изменения применяются сразу.',
            updated: 'Частный DNS обновлён',
            invalid_hostname: 'Введите корректный адрес DNS-провайдера',
            loading_disable: 'Отключение Частного DNS...',
            loading_auto: 'Переключение Частного DNS в автоматический режим...',
            loading_default: 'Применение {{hostname}}...',
            loading_hostname: 'Применение адреса Частного DNS...',
            mode_off: 'Выкл',
            mode_auto: 'Авто',
            mode_provider: 'DNS-провайдер',
            unavailable_short: 'Недоступно'
        },
        diagnostics: {
            title: 'Диагностика',
            subtitle: 'Проверьте текущее состояние рантайма до того, как уходить в сырые логи.',
            run: 'Запустить диагностику',
            running: 'Диагностика...',
            overlay_running: 'Выполняется диагностика...',
            failed: 'Диагностика завершилась с ошибкой',
            completed: 'Диагностика завершена',
            error: 'Ошибка диагностики: {{message}}',
            empty_title: 'Снимок диагностики пока не создан',
            empty_text: 'Запустите проверку, чтобы подтвердить работу процесса, цепочки фаервола и другие показатели работы перед разбором сырых логов.',
            summary: 'Успешно: {{ok}} · С ошибкой: {{fail}} / {{total}}',
            expanded: 'Подробный список раскрыт',
            collapsed: 'Подробный список скрыт',
            show_details: 'Показать детали ({{count}})',
            hide_details: 'Скрыть детали',
            names: {
                process: 'Процесс {{subject}}',
                userlist_binding: 'Привязка list-user',
                network_mode: 'Сетевой режим',
                private_dns: 'Частный DNS',
                routing_ipv4: 'Маршрутизация IPv4',
                routing_ipv6: 'Маршрутизация IPv6'
            },
            details: {
                command_available: 'команда доступна',
                command_missing: 'команда отсутствует',
                ip6tables_not_required: 'не требуется в режиме только IPv4',
                ip6tables_available: 'команда доступна',
                ip6tables_unusable: 'присутствует, но не работает',
                ip6tables_missing_fallback: 'команда отсутствует, авто-режим перейдёт в режим только IPv4',
                runtime_file_present: 'файл присутствует',
                runtime_file_missing: 'файл отсутствует',
                process_running: 'запущен (pid: {{pid}})',
                process_not_running: 'не запущен',
                userlist_attached: 'текущая конфигурация использует list-user.txt',
                userlist_detached: 'текущая конфигурация не ссылается на list-user.txt',
                network_ipv4_only: 'Только IPv4',
                network_auto_dual: 'Авто (IPv4 + IPv6)',
                network_auto_fallback: 'Авто (откат на IPv4)',
                private_dns_unavailable: 'команда settings отсутствует',
                private_dns_off: 'Выкл',
                private_dns_auto: 'Авто',
                private_dns_hostname_default: 'провайдер по умолчанию ({{hostname}})',
                private_dns_hostname_custom: 'пользовательский провайдер ({{hostname}})',
                private_dns_hostname_unspecified: 'адрес провайдера',
                jump_present: 'переход присутствует',
                jump_missing: 'переход отсутствует',
                jump_skipped_ipv4_only: 'пропущено (путь только IPv4)',
                routing_ok: 'маршрут доступен',
                routing_fail: 'проверка маршрута завершилась с ошибкой',
                routing_disabled: 'отключено режимом'
            }
        },
        logs: {
            title: 'Логи',
            runtime_meta: 'stdout / stderr nfqws2',
            runtime_tab: 'nfqws2',
            events_tab: 'События',
            loading_runtime: 'Загрузка лога работы...',
            runtime_empty: 'Лог работы пуст.',
            events_empty: 'События пока не записаны.',
            event_history: 'История событий',
            clear_events: 'Очистить',
            clearing_events: 'Очистка истории событий...',
            cleared_events: 'История событий очищена',
            clear_failed: 'Не удалось очистить: {{message}}'
        },
        generic: {
            error_with_message: 'Ошибка: {{message}}'
        },
        counts: {
            domains: {
                one: '{{count}} домен',
                few: '{{count}} домена',
                many: '{{count}} доменов',
                other: '{{count}} домена'
            },
            events: {
                one: '{{count}} событие',
                few: '{{count}} события',
                many: '{{count}} событий',
                other: '{{count}} события'
            },
            lines: {
                one: '{{count}} строка',
                few: '{{count}} строки',
                many: '{{count}} строк',
                other: '{{count}} строки'
            },
            entries: {
                one: '{{count}} запись',
                few: '{{count}} записи',
                many: '{{count}} записей',
                other: '{{count}} записи'
            }
        }
    },
    en: {
        aria: {
            sections: 'Sections',
            language: 'Interface language'
        },
        nav: {
            runtime: 'Runtime',
            tools: 'Settings',
            logs: 'Logs'
        },
        common: {
            save: 'Save',
            save_restart: 'Save & Restart',
            reload: 'Reload',
            add: 'Add',
            clear: 'Clear',
            end: 'End',
            live: 'LIVE',
            loading: 'Loading...',
            applying_changes: 'Applying changes...',
            unknown: 'unknown',
            remove_domain: 'Remove domain'
        },
        status: {
            checking: 'Checking...',
            active: 'Active',
            inactive: 'Inactive',
            multi_pid: 'Multi-PID',
            error: 'Status Error',
            refresh_failed: 'Status refresh failed',
            labels: {
                network_mode: 'Network Mode',
                private_dns: 'Private DNS',
                domains: 'Domains',
                google_domains: 'Google Domains',
                personal_domains: 'Personal Domains',
                ipv4_rules: 'IPv4 Rules',
                ipv6_rules: 'IPv6 Rules'
            }
        },
        actions: {
            start: 'Start',
            stop: 'Stop',
            restart: 'Restart',
            update: 'Update',
            starting: 'Starting nzapret...',
            stopping: 'Stopping nzapret...',
            restarting: 'Restarting nzapret...',
            updating_data: 'Updating data...',
            completed: '{{command}} completed'
        },
        user_list: {
            title: 'Personal Domain List',
            subtitle: 'Add or remove domains, then tap Save. Reload restores the saved list from the device, and nfqws2 will pick hostlist changes up without a restart.',
            empty: 'No personal domains yet. Add one below to include it in the active hostlist.',
            quick_placeholder: 'Add one domain, then tap Add',
            dirty_none: 'No unsaved changes.',
            dirty_unsaved: 'Unsaved changes. Press Save to apply them.',
            binding_applied: 'Applied by the current configuration.',
            binding_missing: 'Current configuration does not reference list-user.txt yet.',
            binding_unknown: 'Configuration status unavailable.',
            load_failed: 'Failed to load personal list',
            reloaded: 'Personal list reloaded',
            comments_not_added: 'Comments are not added here',
            already_exists: 'Domain already in list',
            saving: 'Saving personal domains...',
            clearing: 'Clearing personal domains...',
            saved: 'Personal list saved',
            cleared: 'Personal list cleared'
        },
        network: {
            title: 'Network Stack',
            subtitle: 'Choose whether nzapret should keep IPv6 interception enabled or stay in a dedicated IPv4-only mode.',
            auto_label: 'Auto',
            auto_meta: 'Use IPv4 and keep IPv6 ready when supported.',
            ipv4_only_label: 'IPv4 Only',
            ipv4_only_meta: 'Skip ip6tables rules and IPv6 bind-fix on restart.',
            dirty_none: 'No unsaved changes.',
            dirty_unsaved: 'Unsaved changes.',
            ipv6_unavailable: 'IPv6 is unavailable. Enable IPv6 in network settings, then return here.',
            ipv6_checking: 'Checking IPv6 availability...',
            auto_requires_ipv6: 'Auto mode requires active IPv6 connectivity',
            enable_ipv6_hint: 'Enable IPv6 in network settings, then return here',
            saving: 'Saving network mode...',
            saving_restart: 'Saving network mode and restarting nzapret...',
            saved: 'Network mode saved',
            saved_restart: 'Network mode saved and nzapret restarted',
            saved_restart_failed: 'Network mode saved, but restart failed',
            mode_ipv4_only: 'IPv4 only',
            mode_auto_dual: 'Auto (IPv4 + IPv6)',
            mode_auto_fallback: 'Auto (IPv4 only fallback)'
        },
        private_dns: {
            title: 'Private DNS',
            subtitle_html: 'Manage Android system Private DNS. nzapret will initialize <code>{{default_hostname}}</code> on the first service start unless the device already uses another provider hostname.',
            off_label: 'Off',
            off_meta: 'Disable Private DNS for the Android system resolver.',
            auto_label: 'Automatic',
            auto_meta: 'Let Android use encrypted DNS when the active network supports it.',
            default_meta: 'Apply the nzapret default provider hostname right away.',
            hostname_placeholder: 'dns.example.com',
            apply_hostname: 'Apply Hostname',
            status_initial: 'Private DNS status will appear here after the first refresh.',
            status_unavailable: 'Private DNS controls are unavailable because the Android settings command is missing on this build.',
            status_init_pending: 'nzapret will initialize {{default_hostname}} on the first service start unless another provider hostname is already configured.',
            status_off: 'Private DNS is disabled for the Android system resolver.',
            status_default_active: '{{hostname}} is active as the nzapret default provider. Changes apply immediately.',
            status_custom_active: 'Custom provider {{hostname}} is active. Changes apply immediately.',
            status_custom_unspecified: 'Custom provider hostname is active. Changes apply immediately.',
            status_auto: 'Automatic mode lets Android use encrypted DNS when the active network supports it. Changes apply immediately.',
            updated: 'Private DNS updated',
            invalid_hostname: 'Enter a valid provider hostname',
            loading_disable: 'Disabling Private DNS...',
            loading_auto: 'Switching Private DNS to automatic mode...',
            loading_default: 'Applying {{hostname}}...',
            loading_hostname: 'Applying Private DNS hostname...',
            mode_off: 'Off',
            mode_auto: 'Automatic',
            mode_provider: 'Provider hostname',
            unavailable_short: 'Unavailable'
        },
        diagnostics: {
            title: 'Diagnostics',
            subtitle: 'Inspect current runtime state before diving into raw logs.',
            run: 'Run Diagnose',
            running: 'Running Diagnose...',
            overlay_running: 'Running diagnostics...',
            failed: 'Diagnostics failed',
            completed: 'Diagnostics completed',
            error: 'Diagnostics error: {{message}}',
            empty_title: 'No diagnostic snapshot yet',
            empty_text: 'Run a health check to confirm the process, firewall chains, and other live signals before chasing raw output.',
            summary: '{{ok}} passed · {{fail}} failed / {{total}}',
            expanded: 'Detailed checklist expanded',
            collapsed: 'Detailed checklist hidden',
            show_details: 'Show Details ({{count}})',
            hide_details: 'Hide Details',
            names: {
                process: '{{subject}} process',
                userlist_binding: 'list-user binding',
                network_mode: 'network mode',
                private_dns: 'private dns',
                routing_ipv4: 'IPv4 routing',
                routing_ipv6: 'IPv6 routing'
            },
            details: {
                command_available: 'command available',
                command_missing: 'command missing',
                ip6tables_not_required: 'not required in IPv4-only mode',
                ip6tables_available: 'command available',
                ip6tables_unusable: 'present but unusable',
                ip6tables_missing_fallback: 'missing, auto mode will use IPv4-only fallback',
                runtime_file_present: 'file present',
                runtime_file_missing: 'file missing',
                process_running: 'running (pid: {{pid}})',
                process_not_running: 'not running',
                userlist_attached: 'current configuration includes list-user.txt',
                userlist_detached: 'current configuration does not reference list-user.txt',
                network_ipv4_only: 'IPv4 only',
                network_auto_dual: 'Auto (IPv4 + IPv6)',
                network_auto_fallback: 'Auto (IPv4 only fallback)',
                private_dns_unavailable: 'settings command missing',
                private_dns_off: 'Off',
                private_dns_auto: 'Automatic',
                private_dns_hostname_default: 'Provider hostname ({{hostname}})',
                private_dns_hostname_custom: 'Provider hostname ({{hostname}})',
                private_dns_hostname_unspecified: 'Provider hostname',
                jump_present: 'jump present',
                jump_missing: 'jump missing',
                jump_skipped_ipv4_only: 'skipped (IPv4-only path)',
                routing_ok: 'route lookup works',
                routing_fail: 'route lookup failed',
                routing_disabled: 'disabled by mode'
            }
        },
        logs: {
            title: 'Logs',
            runtime_meta: 'nfqws2 stdout / stderr',
            runtime_tab: 'nfqws2',
            events_tab: 'Events',
            loading_runtime: 'Loading runtime log...',
            runtime_empty: 'Runtime log is empty.',
            events_empty: 'No events recorded yet.',
            event_history: 'Event history',
            clear_events: 'Clear Events',
            clearing_events: 'Clearing event history...',
            cleared_events: 'Event history cleared',
            clear_failed: 'Clear failed: {{message}}'
        },
        generic: {
            error_with_message: 'Error: {{message}}'
        },
        counts: {
            domains: {
                one: '{{count}} domain',
                other: '{{count}} domains'
            },
            events: {
                one: '{{count}} event',
                other: '{{count}} events'
            },
            lines: {
                one: '{{count}} line',
                other: '{{count}} lines'
            },
            entries: {
                one: '{{count}} entry',
                other: '{{count}} entries'
            }
        }
    }
};

let currentLocale = DEFAULT_LOCALE;

function resolveLocale(locale) {
    return SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function getValue(locale, key) {
    return key.split('.').reduce((acc, part) => {
        if (acc && typeof acc === 'object' && part in acc) {
            return acc[part];
        }
        return undefined;
    }, translations[locale]);
}

function interpolate(template, params = {}) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            return String(params[key]);
        }
        return '';
    });
}

function getPluralRules(locale) {
    return new Intl.PluralRules(locale);
}

function getStoredLocale() {
    try {
        return localStorage.getItem(LOCALE_STORAGE_KEY) || '';
    } catch (error) {
        return '';
    }
}

function setStoredLocale(locale) {
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (error) {
        // Ignore storage errors in restrictive WebViews.
    }
}

function messageForLocale(locale, key) {
    return getValue(locale, key) ?? getValue(FALLBACK_LOCALE, key);
}

function formatNumber(value) {
    const number = Number(value);
    const safeNumber = Number.isFinite(number) ? number : 0;
    return new Intl.NumberFormat(currentLocale).format(safeNumber);
}

function t(key, params = {}) {
    const value = messageForLocale(currentLocale, key);
    if (typeof value === 'undefined') {
        return key;
    }
    if (typeof value === 'object') {
        return interpolate(value.other ?? key, params);
    }
    return interpolate(value, params);
}

function tc(key, count, params = {}) {
    const value = messageForLocale(currentLocale, key);
    if (!value || typeof value !== 'object') {
        return t(key, params);
    }

    const rule = getPluralRules(currentLocale).select(Number(count));
    const template = value[rule] ?? value.other ?? Object.values(value)[0] ?? key;
    return interpolate(template, {
        count: formatNumber(count),
        raw_count: String(count),
        ...params
    });
}

function applyStaticTranslations(root = document, params = {}) {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = t(element.dataset.i18n, params);
    });

    // Only use data-i18n-html for trusted built-in markup. It writes via innerHTML
    // and must never receive user-controlled content or unreviewed translation HTML.
    root.querySelectorAll('[data-i18n-html]').forEach((element) => {
        element.innerHTML = t(element.dataset.i18nHtml, params);
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        element.placeholder = t(element.dataset.i18nPlaceholder, params);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((element) => {
        element.title = t(element.dataset.i18nTitle, params);
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel, params));
    });
}

function initializeLocale() {
    currentLocale = resolveLocale(getStoredLocale() || DEFAULT_LOCALE);
    document.documentElement.lang = currentLocale;
    return currentLocale;
}

function setLocale(locale) {
    currentLocale = resolveLocale(locale);
    setStoredLocale(currentLocale);
    document.documentElement.lang = currentLocale;
    return currentLocale;
}

function getLocale() {
    return currentLocale;
}

export {
    DEFAULT_LOCALE,
    LOCALE_STORAGE_KEY,
    SUPPORTED_LOCALES,
    applyStaticTranslations,
    formatNumber,
    getLocale,
    initializeLocale,
    setLocale,
    t,
    tc
};
