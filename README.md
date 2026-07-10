<div align="center">

# ✈️ nztgproxy (nztg)

**Минималистичный MTProto-прокси на Go для обхода блокировок Telegram на Android**

[![Language](https://img.shields.io/badge/Language-Go-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Linux-2ea44f?style=flat-square)](https://android.com)
[![CGO](https://img.shields.io/badge/CGO-CGO--free-1f6feb?style=flat-square)](https://golang.org/cmd/cgo/)
[![Protocol](https://img.shields.io/badge/Protocol-MTProto%20%E2%86%92%20WSS-f59e0b?style=flat-square)](https://core.telegram.org/mtproto)
[![Status](https://img.shields.io/badge/Status-MVP%20%2F%20Stable-8b5cf6?style=flat-square)](https://github.com/nikitos4683/nzapret/tree/nztg)

[![English](https://img.shields.io/badge/Translate%20to-English-blue?style=flat-square&logo=google-translate&logoColor=white)](README.en.md)

</div>

---

**nztgproxy** (бинарник `nztg`) — это легковесный, статический и CGO-free прокси-сервер на Go. Он является портом ядра популярного проекта [tg-ws-proxy](https://github.com/Flowseal/tg-ws-proxy) и используется в качестве движка обхода DPI для Telegram внутри Android-модуля **`nzapret`**.

Подобно тому, как `nfqws2` выступает DPI-движком для веб-трафика, `nztg` берёт на себя задачу обеспечения стабильной связи Telegram с его датацентрами (DCs) через протокол WebSocket-over-TLS (WSS) с поддержкой прямого TCP-отката и Cloudflare-проксирования.

---

## ⚡ Ключевые возможности

* **🔄 WebSocket-over-TLS (WSS):** Перепаковывает стандартный MTProto-трафик в защищенные WebSocket-фреймы для обхода сигнатурного анализа и блокировки IP-адресов датацентров Telegram.
* **☁️ Резервное Cloudflare-проксирование:** Автоматический фолбэк на Cloudflare Worker / CDN Fronting в случае полной блокировки адресов WebSocket-серверов Telegram.
* **🔌 Умный DNS-резолвер:** Встроенная поддержка публичных DNS (`1.1.1.1`, `8.8.8.8`, `9.9.9.9`) для обхода проблемы отсутствия `/etc/resolv.conf` в среде Android при отключенном CGO.
* **🍃 CGO-free статический ELF:** Сборка с `CGO_ENABLED=0` гарантирует запуск на любом Android-ядре без зависимостей от системных библиотек.
* **📦 Полная интеграция:** Разработано специально для бесшовного запуска управляющим CLI-скриптом модуля `nzapret`.

---

## 🚦 Текущий статус реализации (MVP)

### ✅ Реализовано:
- [x] Декодирование обфусцированного MTProto рукопожатия (`tryHandshake`).
- [x] Генерация инициализации релея + AES-CTR контекст шифрования.
- [x] WSS-клиент (`wss://kws{dc}[-1].web.telegram.org/apiws` через IP-адрес DC).
- [x] Попакетная упаковка MTProto фреймов в WebSocket (`splitter`).
- [x] Двунаправленный мост с шифрованием на лету.
- [x] Прямой TCP-откат к оригинальным IP датацентров, если WS недоступен.
- [x] Тестирование доступности Cloudflare (`cftest`).
- [x] Балансировщик доменов (sticky-домен на DC + шафл-фолбэк по пулу).

### ⏳ В планах (Backlog):
- [ ] Пул переиспользуемых WS-соединений.

---

## 🛠 Сборка

Сборка осуществляется одной командой и производит кросс-компиляцию статических бинарников под основные архитектуры Android:

```sh
# Запуск кросс-компиляции (создает build/nztg-{arm64,arm,x64,x86})
bash build.sh

# Запуск юнит-тестов (проверка криптографии и сплиттера)
go test ./...
```

Имена результирующих файлов в директории `build` соответствуют соглашению наименований `nfqws2-*`.

---

## ⚙️ CLI Параметры и команды

Запуск бинарника поддерживает несколько флагов конфигурации и вспомогательных субкоманд.

### 📋 Субкоманды (выполняются первыми):
* `nztg gensecret` — сгенерировать случайный 32-символьный hex-секрет MTProto и вывести в консоль.
* `nztg cftest [флаги]` — протестировать доступность Cloudflare-прокси.

---

### 🎛 Флаги запуска:
| Флаг | Значение по умолчанию | Описание |
| :--- | :--- | :--- |
| `--host <ip>` | `127.0.0.1` | Адрес прослушивания входящих подключений. |
| `--port <n>` | `1443` | Порт прослушивания. |
| `--secret <hex>` | *(Случайный)* | 32-символьный hex-секрет MTProto. |
| `--secret-file <path>`| *(Отсутствует)* | Путь для чтения или автоматического сохранения секрета. |
| `--dc-ip <DC:IP>` | *(Стандартные IPs)* | IP-адрес датацентра Telegram в формате `ID:IP` (repeatable). |
| `--cfproxy-domain <host>`| *(Отсутствует)* | Дополнительный проксируемый домен Cloudflare (repeatable). |
| `--no-cfproxy` | `false` | Отключить резервный обход через Cloudflare. |
| `--link-file <path>` | *(Отсутствует)* | Путь для записи сгенерированной ссылки `tg://proxy?...`. |
| `--verbose` | `false` | Включить подробное логирование отладки. |

---

## 📱 Ручное тестирование на устройстве (ADB)

> [!TIP]
> Вы можете протестировать работу прокси на Android-устройстве вручную через ADB до сборки полноценного zip-модуля.

```sh
# 1. Отправляем нужный бинарник во временную директорию
adb push build/nztg-arm64 /data/local/tmp/nztg

# 2. Выдаем права на исполнение
adb shell chmod 755 /data/local/tmp/nztg

# 3. Запускаем с отладкой и автогенерацией секрета
adb shell /data/local/tmp/nztg \
    --secret-file /data/local/tmp/nztg.secret \
    --link-file /data/local/tmp/nztg.link \
    --verbose
```

После старта скопируйте сгенерированную `tg://proxy` ссылку из файла или вывода консоли и откройте на устройстве в приложении Telegram.

---

## 🧩 Структура исходного кода

Каждая часть прокси-сервера вынесена в отдельный Go-файл:

* 🔌 [main.go](main.go) — Точка входа, парсинг флагов, запуск TCP-слушателя и обработка системных сигналов.
* 🌁 [bridge.go](bridge.go) — Реализация пересылки данных (pipe/bridge) между клиентом и Telegram.
* ☁️ [cfproxy.go](cfproxy.go) — Функции для работы с Cloudflare, включая тестирование доступности.
* 🔐 [crypto.go](crypto.go) — Логика шифрования AES-CTR-128 и расшифровка обфусцированного MTProto.
* 📡 [dns.go](dns.go) — Кастомный резолвер имен для обхода отсутствия системного резолвера.
* ✂️ [splitter.go](splitter.go) — Сплиттер пакетов для правильной нарезки MTProto данных во фреймы WebSocket.
* 🌐 [websocket.go](websocket.go) — Инициализация WSS соединения с поддержкой кастомных заголовков.

---

## 📄 Лицензия

Этот проект распространяется под лицензией [MIT](LICENSE). Подробную информацию можно найти в файле [LICENSE](LICENSE).

---

<div align="center">
  <b>🌍 Свободного интернета и приятного использования Telegram!</b>
</div>
