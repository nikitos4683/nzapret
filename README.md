<div align="center">

# nzapret

**Android-first DPI bypass utility for Magisk / KernelSU**

Небольшой модуль для Android, который поднимает `nfqws`, собирает `iptables`/`ip6tables` NFQUEUE-правила и даёт управление через CLI и KernelSU WebUI.

![Android](https://img.shields.io/badge/Platform-Android-2ea44f?style=for-the-badge)
![Root](https://img.shields.io/badge/Root-Magisk%20%7C%20KernelSU-1f6feb?style=for-the-badge)
![Engine](https://img.shields.io/badge/Engine-nfqws-f59e0b?style=for-the-badge)
![UI](https://img.shields.io/badge/UI-KernelSU%20WebUI-8b5cf6?style=for-the-badge)
![Shell](https://img.shields.io/badge/Runtime-POSIX%20sh-ff6b6b?style=for-the-badge)

</div>

> `nzapret` не позиционируется как очередной форк-обёртка. Это самостоятельная Android-утилита, собранная вокруг идей оригинального [bol-van/zapret](https://github.com/bol-van/zapret), но упрощённая и переосмысленная под модульный mobile-first сценарий.

## Что это

`nzapret` нужен для Android-устройств с root-доступом, где хочется получить компактный DPI-bypass модуль без лишней desktop-наследственности.

Вместо тяжёлой конфигурационной оболочки здесь сделан прямой Android-first подход:

- модуль ставится как обычный Magisk/KernelSU ZIP;
- на старте поднимает `nfqws` и NFQUEUE-правила для IPv4/IPv6;
- управляется через `sh`-CLI и KernelSU WebUI;
- не тянет сеть на boot и не пытается "магически" обновляться сам;
- хранит логику рантайма в простых shell-скриптах, которые легко читать и сопровождать.

## Почему nzapret

- **Android-first архитектура.** Проект не пытается быть переносом ПК-утилиты один в один.
- **Простой жизненный цикл.** `start`, `stop`, `restart`, `status`, `update`, `log`, `diagnose`.
- **Честное поведение на boot.** При старте используются только локальные файлы, без автоскачиваний и фоновых чекеров.
- **Нормальный контроль состояния.** Есть CLI, статус в JSON и WebUI с раздельными runtime и diagnostics логами.
- **Минимальный surface area.** Убраны мёртвые или полурабочие настройки вроде `game-filter`, `auto-update` и source-редактора.

## Что умеет сейчас

- запускать `nfqws` из выбранного профиля;
- создавать и чистить IPv4/IPv6 NFQUEUE-цепочки в `mangle`;
- перехватывать трафик в `OUTPUT` и `FORWARD`;
- переключать профили обхода;
- вручную обновлять доменный routing list;
- отдавать состояние в JSON для WebUI;
- показывать отдельный runtime log и отдельный diagnostics log в WebUI.

## Что важно знать

- В текущем runtime реально используются только hostlist-файлы из профиля: `list-general.txt` и `list-google.txt`.
- Модуль сейчас сосредоточен на hostlist-first модели без отдельной IP-based подсистемы.
- В поставку входят только те payload-файлы, которые использует активный профиль по умолчанию.
- В комплекте сейчас один профиль: `default`.
- KernelSU WebUI встроен в модуль. Если вы используете только Magisk, основной способ управления для вас это CLI и `action.sh`.

## Быстрый старт

### Установка

1. Соберите или скачайте ZIP-модуль.
2. Установите архив через Magisk или KernelSU как обычный модуль.
3. Перезагрузите устройство или запустите модуль вручную после установки.
4. Откройте WebUI в KernelSU или используйте CLI-команды ниже.

### Базовые команды

```sh
sh /data/adb/modules/nzapret/system/bin/nzapret status
sh /data/adb/modules/nzapret/system/bin/nzapret start
sh /data/adb/modules/nzapret/system/bin/nzapret stop
sh /data/adb/modules/nzapret/system/bin/nzapret restart
```

### Обновление списков

```sh
sh /data/adb/modules/nzapret/system/bin/nzapret update list
sh /data/adb/modules/nzapret/system/bin/nzapret update
```

### Диагностика

```sh
sh /data/adb/modules/nzapret/system/bin/nzapret diagnose
sh /data/adb/modules/nzapret/system/bin/nzapret log
```

## CLI-команды

| Команда | Что делает |
| --- | --- |
| `start` | Запускает `nfqws` и собирает правила |
| `stop` | Останавливает `nfqws` и чистит цепочки |
| `restart` | Полностью перезапускает рантайм |
| `status` | Показывает состояние в человекочитаемом виде |
| `status --json` | Отдаёт JSON-статус для WebUI и интеграций |
| `update [list]` | Ручное обновление routing hostlist |
| `profile status` | Показывает текущий профиль |
| `profile list` | Показывает доступные профили |
| `profile set <name>` | Переключает активный профиль |
| `log` | Показывает процесс и последние строки лога |
| `diagnose` | Запускает Android-side диагностику |

## Как устроен проект

### Runtime

- [`service.sh`](./service.sh) поднимает `nfqws`, загружает профиль и пересобирает `iptables`/`ip6tables`.
- [`uninstall.sh`](./uninstall.sh) отвечает за stop/cleanup.
- [`system/bin/nzapret`](./system/bin/nzapret) это основной CLI и JSON-источник для WebUI.
- [`action.sh`](./action.sh) даёт быстрый toggle `start/stop`.

### Данные и профили

- [`profiles/`](./profiles) хранит профили `nfqws`.
- [`lists/`](./lists) хранит только активные hostlists, используемые рантаймом.
- [`payloads/`](./payloads) содержит только бинарные TLS/QUIC payloads, реально используемые профилем.

### Интерфейс

- [`webroot/index.html`](./webroot/index.html) и [`webroot/style.css`](./webroot/style.css) это встроенный KernelSU WebUI.
- WebUI не управляет рантаймом напрямую: он вызывает CLI-команды через `ksu.exec(...)`.

## Текущая архитектурная модель

Проект специально упрощён под Android:

- без интерактивного shell-меню;
- без boot-time network activity;
- без автопроверок и автоскачиваний при старте;
- без UI-настроек, которые не отражаются на реальном runtime.

Это сознательная ставка на надёжность и предсказуемость: модуль должен либо стартовать локально и прозрачно, либо честно показать ошибку и диагностический вывод.

## Сборка из исходников

Требования:

- `bash`
- `zip`
- `sed`
- `mktemp`

Сборка:

```sh
bash build.sh
```

Результат:

```text
nzapret-vX.Y.Z.zip
```

`build.sh` собирает архив из текущего корня репозитория, нормализует LF line endings и вычищает runtime-артефакты только во временном staging-каталоге.

## Структура репозитория

```text
.
├── action.sh
├── build.sh
├── customize.sh
├── module.prop
├── service.sh
├── uninstall.sh
├── bin/
├── lists/
├── META-INF/
├── payloads/
├── profiles/
├── system/bin/nzapret
├── utils/
└── webroot/
```

## Для разработчиков

- Установочный путь модуля зашит как `/data/adb/modules/nzapret`.
- `service.sh`, `uninstall.sh`, `action.sh` и `system/bin/nzapret` должны оставаться совместимыми с Android `sh`.
- Если меняется JSON-формат `status --json`, нужно обновлять и WebUI в той же правке.
- Если в корне проекта появляются новые обязательные файлы модуля, нужно обновлять [`build.sh`](./build.sh).

Более детальная карта кода и инвариантов лежит в [`AGENTS.md`](./AGENTS.md).

## Благодарности

- Идеи, исследования и экосистема обхода DPI: [bol-van/zapret](https://github.com/bol-van/zapret)
- Низкоуровневый движок обхода в модуле: `nfqws`

## Предупреждение

Используйте `nzapret` осознанно и на свой риск. Поведение DPI-bypass инструментов зависит от прошивки, root-стека, сети оператора и конкретных приложений, поэтому рабочая конфигурация на одном устройстве не гарантирует такой же результат на другом.
