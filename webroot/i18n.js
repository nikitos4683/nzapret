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
            reload: 'Обновить',
            add: 'Добавить',
            clear: 'Очистить',
            end: 'Вниз',
            live: 'LIVE',
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
            off: 'Выкл',
            tg_port: 'Порт {{port}}',
            tg_port_cf: 'Порт {{port}} (CF)',
            labels: {
                private_dns: 'Частный DNS',
                telegram: 'Telegram',
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
        tg: {
            title: 'Telegram',
            subtitle: 'Локальный MTProto-прокси для обхода блокировки Telegram. Подключите клиент кнопкой ниже.',
            open: 'Открыть в Telegram',
            copy_link: 'Копировать ссылку',
            regen: 'Сгенерировать новый secret',
            mtproto_title: 'Подключение MTProto',
            host: 'IP-адрес',
            port: 'Порт',
            secret: 'Secret',
            dc_title: 'Датацентры Telegram (DC → IP)',
            dc_hint: 'По одному правилу на строку, формат: номер:IP',
            dc_tooltip: 'Соответствие номера датацентра Telegram (DC) и IP-адреса сервера. Каждая строка: «номер:IP», например 4:149.154.167.220. Прокси по этим правилам направляет трафик к нужным серверам Telegram.\n\nЕсли у вас не работают медиа и работает CF-прокси, то попробуйте убрать строку 2:149.154.167.220',
            cf_title: 'Cloudflare Proxy',
            cf_enable: 'Включить CF-прокси',
            cf_custom: 'Свой домен',
            cf_custom_placeholder: 'example.com',
            cf_test: 'Тест CF-прокси',
            cf_testing: 'Проверка CF-прокси...',
            cf_test_ok: 'CF-прокси работает ({{domain}})',
            cf_test_fail: 'CF-прокси недоступен: {{error}}',
            preresolve_enable: 'Прогрев соединений с DC',
            preresolve_tooltip: 'Заранее открывает пул соединений к каждому датацентру при старте, чтобы Telegram подключался мгновенно. Если прямой путь заблокирован — сразу выбирается запасной маршрут (CF/TCP). Если выключить, пул заполняется при первом подключении.',
            dirty_none: 'Несохранённых изменений нет.',
            dirty_pending: 'Есть несохранённые изменения. Нажмите «Сохранить».',
            saving: 'Сохранение настроек Telegram...',
            saving_restart: 'Сохранение и перезапуск...',
            saved: 'Настройки Telegram сохранены',
            saved_restart: 'Настройки сохранены, служба перезапущена',
            regenerating: 'Генерация нового secret...',
            secret_regenerated: 'Сгенерирован новый secret',
            opening: 'Открытие Telegram...',
            opened: 'Открываю Telegram',
            copied: 'Ссылка скопирована',
            copy_failed: 'Не удалось скопировать ссылку',
            invalid_host: 'Укажите корректный IP-адрес',
            invalid_port: 'Порт должен быть числом 1–65535',
            invalid_dc: 'Неверное правило DC: {{line}}',
            invalid_domain: 'Некорректный домен'
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
            summary: '{{passed}} · {{failed}} / {{total}}',
            summary_passed: 'Успешно: {{ok}}',
            summary_failed: 'С ошибкой: {{fail}}',
            expanded: 'Подробный список раскрыт',
            collapsed: 'Подробный список скрыт',
            show_details: 'Показать детали ({{count}})',
            hide_details: 'Скрыть детали',
            names: {
                process: 'Процесс {{subject}}',
                userlist_binding: 'Привязка list-user',
                ip_stack: 'IP-стек',
                private_dns: 'Частный DNS',
                routing_ipv4: 'Маршрутизация IPv4',
                routing_ipv6: 'Маршрутизация IPv6'
            },
            details: {
                command: {
                    available: 'команда доступна',
                    missing: 'команда отсутствует'
                },
                ip6tables_runtime: {
                    available: 'команда доступна',
                    unusable: 'присутствует, но не работает',
                    missing_fallback: 'команда отсутствует, фаервол только для IPv4'
                },
                runtime_file: {
                    present: 'файл присутствует',
                    missing: 'файл отсутствует'
                },
                process: {
                    running: 'запущен (pid: {{pid}})',
                    not_running: 'не запущен'
                },
                userlist_binding: {
                    attached: 'текущая конфигурация использует list-user.txt',
                    detached: 'текущая конфигурация не ссылается на list-user.txt'
                },
                ip_stack: {
                    ipv4_only: 'Только IPv4',
                    dual_stack: 'IPv4 + IPv6'
                },
                private_dns: {
                    unavailable: 'команда settings отсутствует',
                    off: 'Выкл',
                    auto: 'Авто',
                    hostname_default: 'провайдер по умолчанию ({{hostname}})',
                    hostname_custom: 'пользовательский провайдер ({{hostname}})',
                    hostname_unspecified: 'адрес провайдера'
                },
                jump_rule: {
                    present: 'переход присутствует',
                    missing: 'переход отсутствует',
                    skipped_no_ipv6: 'пропущено (фаервол только для IPv4)'
                },
                routing: {
                    ok: 'маршрут доступен',
                    fail: 'проверка маршрута завершилась с ошибкой',
                    unavailable: 'недоступно в этой сети'
                }
            }
        },
        logs: {
            title: 'Логи',
            runtime_meta: 'stdout / stderr nfqws2',
            nztg_meta: 'stdout / stderr nztg (Telegram)',
            runtime_tab: 'nfqws2',
            nztg_tab: 'nztg',
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
            reload: 'Reload',
            add: 'Add',
            clear: 'Clear',
            end: 'End',
            live: 'LIVE',
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
            off: 'Off',
            tg_port: 'Port {{port}}',
            tg_port_cf: 'Port {{port}} (CF)',
            labels: {
                private_dns: 'Private DNS',
                telegram: 'Telegram',
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
        tg: {
            title: 'Telegram',
            subtitle: 'Local MTProto proxy to bypass Telegram blocking. Connect your client with the button below.',
            open: 'Open in Telegram',
            copy_link: 'Copy link',
            regen: 'Generate a new secret',
            mtproto_title: 'MTProto connection',
            host: 'IP address',
            port: 'Port',
            secret: 'Secret',
            dc_title: 'Telegram datacenters (DC → IP)',
            dc_hint: 'One rule per line, format: number:IP',
            dc_tooltip: 'Maps a Telegram datacenter number (DC) to a server IP. Each line is "number:IP", e.g. 4:149.154.167.220. The proxy routes traffic to the right Telegram servers by these rules.\n\nIf media does not load while the CF proxy works, try removing the 2:149.154.167.220 line.',
            cf_title: 'Cloudflare Proxy',
            cf_enable: 'Enable CF proxy',
            cf_custom: 'Custom domain',
            cf_custom_placeholder: 'example.com',
            cf_test: 'Test CF proxy',
            cf_testing: 'Testing CF proxy...',
            cf_test_ok: 'CF proxy works ({{domain}})',
            cf_test_fail: 'CF proxy unavailable: {{error}}',
            preresolve_enable: 'Warm up DC connections',
            preresolve_tooltip: 'Opens a pool of ready connections to each datacenter at startup so Telegram connects instantly. If the direct path is blocked, the fallback route (CF/TCP) is selected right away. When off, the pool fills on the first connection.',
            dirty_none: 'No unsaved changes.',
            dirty_pending: 'Unsaved changes. Press Save.',
            saving: 'Saving Telegram settings...',
            saving_restart: 'Saving and restarting...',
            saved: 'Telegram settings saved',
            saved_restart: 'Settings saved, service restarted',
            regenerating: 'Generating a new secret...',
            secret_regenerated: 'New secret generated',
            opening: 'Opening Telegram...',
            opened: 'Opening Telegram',
            copied: 'Link copied',
            copy_failed: 'Failed to copy link',
            invalid_host: 'Enter a valid IP address',
            invalid_port: 'Port must be a number 1–65535',
            invalid_dc: 'Invalid DC rule: {{line}}',
            invalid_domain: 'Invalid domain'
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
            summary: '{{passed}} · {{failed}} / {{total}}',
            summary_passed: '{{ok}} passed',
            summary_failed: '{{fail}} failed',
            expanded: 'Detailed checklist expanded',
            collapsed: 'Detailed checklist hidden',
            show_details: 'Show Details ({{count}})',
            hide_details: 'Hide Details',
            names: {
                process: '{{subject}} process',
                userlist_binding: 'list-user binding',
                ip_stack: 'IP stack',
                private_dns: 'private dns',
                routing_ipv4: 'IPv4 routing',
                routing_ipv6: 'IPv6 routing'
            },
            details: {
                command: {
                    available: 'command available',
                    missing: 'command missing'
                },
                ip6tables_runtime: {
                    available: 'command available',
                    unusable: 'present but unusable',
                    missing_fallback: 'missing, IPv4-only firewall'
                },
                runtime_file: {
                    present: 'file present',
                    missing: 'file missing'
                },
                process: {
                    running: 'running (pid: {{pid}})',
                    not_running: 'not running'
                },
                userlist_binding: {
                    attached: 'current configuration includes list-user.txt',
                    detached: 'current configuration does not reference list-user.txt'
                },
                ip_stack: {
                    ipv4_only: 'IPv4 only',
                    dual_stack: 'IPv4 + IPv6'
                },
                private_dns: {
                    unavailable: 'settings command missing',
                    off: 'Off',
                    auto: 'Automatic',
                    hostname_default: 'Provider hostname ({{hostname}})',
                    hostname_custom: 'Provider hostname ({{hostname}})',
                    hostname_unspecified: 'Provider hostname'
                },
                jump_rule: {
                    present: 'jump present',
                    missing: 'jump missing',
                    skipped_no_ipv6: 'skipped (IPv4-only firewall)'
                },
                routing: {
                    ok: 'route lookup works',
                    fail: 'route lookup failed',
                    unavailable: 'not available on this network'
                }
            }
        },
        logs: {
            title: 'Logs',
            runtime_meta: 'nfqws2 stdout / stderr',
            nztg_meta: 'nztg (Telegram) stdout / stderr',
            runtime_tab: 'nfqws2',
            nztg_tab: 'nztg',
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
// Intl objects are comparatively expensive; build them once per locale.
let numberFormat = null;
let pluralRules = null;

function applyLocale(locale) {
    currentLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
    numberFormat = new Intl.NumberFormat(currentLocale);
    pluralRules = new Intl.PluralRules(currentLocale);
    document.documentElement.lang = currentLocale;
    return currentLocale;
}

function getValue(locale, key) {
    return key.split('.').reduce(
        (acc, part) => (acc && typeof acc === 'object' && part in acc ? acc[part] : undefined),
        translations[locale]
    );
}

function messageFor(key) {
    return getValue(currentLocale, key) ?? getValue(FALLBACK_LOCALE, key);
}

function interpolate(template, params = {}) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : ''
    ));
}

function formatNumber(value) {
    const number = Number(value);
    return numberFormat.format(Number.isFinite(number) ? number : 0);
}

// Whether `key` resolves to a plain message (not a missing key or a group).
function hasMessage(key) {
    return typeof messageFor(key) === 'string';
}

function t(key, params = {}) {
    const value = messageFor(key);
    if (typeof value === 'undefined') {
        return key;
    }
    return interpolate(typeof value === 'object' ? (value.other ?? key) : value, params);
}

function tc(key, count, params = {}) {
    const value = messageFor(key);
    if (!value || typeof value !== 'object') {
        return t(key, params);
    }

    const template = value[pluralRules.select(Number(count))] ?? value.other ?? key;
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
    let stored = '';
    try {
        stored = localStorage.getItem(LOCALE_STORAGE_KEY) || '';
    } catch (error) {
        // Restrictive WebViews may block storage; fall back to the default.
    }
    return applyLocale(stored || DEFAULT_LOCALE);
}

function setLocale(locale) {
    applyLocale(locale);
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
    } catch (error) {
        // Ignore storage errors in restrictive WebViews.
    }
    return currentLocale;
}

function getLocale() {
    return currentLocale;
}

export {
    applyStaticTranslations,
    formatNumber,
    getLocale,
    hasMessage,
    initializeLocale,
    setLocale,
    t,
    tc
};
