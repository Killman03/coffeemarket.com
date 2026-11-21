# Независимый запуск на VPS с coffeemarket.kz

Целевой сервер: Ubuntu 24.04 x86_64, Docker/Compose уже установлены, HTTP/HTTPS обслуживает контейнер `coffeemarket_nginx_prod`. Его внешняя сеть — `coffeemarketkz_coffeemarket_network`. Репозиторий калькулятора находится в `/opt/coffee-market-calculator`. Адрес калькулятора — `https://calc.coffeemarket.kz`.

## Границы и ресурсы

Compose-проект всегда `coffee-market-calculator`: wrapper явно задаёт project name и файл, не выбирает Compose основного сайта. БД `calculator-db` имеет собственный volume и только закрытую backend-сеть. PostgreSQL основного сайта, Redis и боты не используются. Web присоединяется к существующей proxy-сети под уникальным alias `coffee-calculator-web` и публикует только `127.0.0.1:3107`. Работа через эту сеть не требует менять Compose или пересоздавать Nginx.

Web ограничен 512 MiB RAM и 0.75 CPU, PostgreSQL — 384 MiB и 0.5 CPU; swap для новых контейнеров не добавляется. Операционные контейнеры запускаются отдельно и имеют собственные лимиты. Логи ротируются. Приложение работает непривилегированным пользователем с read-only root filesystem. Общие диск, ядро и Docker daemon остаются ресурсами VPS: абсолютную независимость нагрузки даёт отдельная машина.

Сборка выполняется в GitHub Actions. После успешных проверок и Gitleaks публикуются два образа с тегом полного commit SHA: `ghcr.io/killman03/coffeemarket-calculator:<sha>` и `ghcr.io/killman03/coffeemarket-calculator-migrator:<sha>`. На VPS сборка не запускается. Оба образа нужны от одной проверенной ревизии; `latest` не используется. Source/revision labels связывают образ с репозиторием.

## DNS

Создайте A-запись `calc` → `89.218.15.58`. Основную запись домена не менять. Если у поддомена есть AAAA-запись, IPv6 должен вести на этот же корректно обслуживающий сервер; иначе сначала исправьте AAAA. Для HTTP-01 порт 80 должен быть доступен извне. До выпуска сертификата проверьте:

```bash
getent ahostsv4 calc.coffeemarket.kz
```

## Код и готовые образы

Используйте commit, для которого полностью прошёл `Calculator checks`, включая `Publish tested server images`. Переключитесь на него после `git fetch`, проверив отсутствие локальных изменений. Не применяйте reset --hard на чужой checkout.

Первый пакет GHCR по умолчанию private. Для скачивания используйте свой PAT classic **только с read:packages**, а не пароль GitHub. Токен вводится скрыто в SSH-терминале и не отправляется в чат. Credentials Docker вынесены в отдельный каталог; существующие логины registry основного сайта не меняются:

```bash
install -d -m 700 /root/.docker-coffee-calculator
read -rsp 'GitHub PAT (read:packages): ' calculator_registry_token
printf '\n'
printf '%s' "$calculator_registry_token" | docker --config /root/.docker-coffee-calculator login ghcr.io --username Killman03 --password-stdin
unset calculator_registry_token
```

Если владелец отдельно открыл оба пакета для публичного чтения, login не требуется. Код проекта публичный, но видимость registry не меняется автоматически. Docker сохраняет registry credential в своём каталоге; каталог доступен только root.

## Первое развёртывание

Все следующие команды выполняются по SSH от root в **новом** checkout калькулятора. На существующей БД повторный prepare не запускайте: генератор намеренно отказывает в перезаписи secrets.

```bash
cd /opt/coffee-market-calculator
revision=$(git rev-parse HEAD)
bash deploy/prepare.sh "$revision" https://calc.coffeemarket.kz
bash deploy/compose.sh config --quiet
bash deploy/compose.sh pull calculator-db
bash deploy/compose.sh up -d --wait calculator-db
bash deploy/compose.sh run --rm migrate
bash deploy/compose.sh run --rm grant
bash deploy/compose.sh run --rm operator
bash deploy/compose.sh up -d --wait calculator-web
curl --fail --silent --show-error http://127.0.0.1:3107/api/health/ready
bash deploy/compose.sh ps
```

`operator` интерактивно создаёт единственного владельца, запрашивая email/имя/пароль. Первоначальные роли созданы init SQL только в новом Postgres-volume. Миграции используют отдельную DDL-роль, app — ограниченную DML-роль, operator — отдельную роль для учётной записи. Секреты находятся в `/etc/coffee-market-calculator` (каталог 0700, файлы 0600) и не попадают в Git, образы или stdout. Подробнее — [NODE_AUTH.md](NODE_AUTH.md).

`prepare.sh` проверяет ревизию, чистоту tracked-кода, наличие Docker/proxy-сети, текущую конфигурацию Nginx, свободный порт 3107, минимум 1.5 GiB available RAM и 6 GiB диска. Он не устанавливает/обновляет Docker или ОС. Если генерация прервана, не удаляйте volume/секреты: сначала проверьте, какие файлы успели создаться. Полный набор конфигурации после успешного prepare позволяет продолжать со следующей команды. Изменение образов/обновление существующей установки описано ниже.

## Домен и HTTPS без остановки основного сайта

Nginx читает существующий persistent template `/var/www/coffeemarket.kz/nginx/conf.d/coffeemarket.conf`; Docker entrypoint генерирует из него `/etc/nginx/conf.d/default.conf`. `proxy-append.sh` добавляет **только новые server blocks** в конец template и живого generated-конфига. Существующие блоки не переписываются. Оба файла заранее сохраняются в root-only backup под `/etc/coffee-market-calculator/nginx-backup.*`. При ошибке до успешного reload helper восстанавливает оба файла на месте. Проверка `nginx -t` обязательна перед graceful reload. `docker restart` основного Nginx не применяется.

Сначала создать маршрут HTTP-01. Установите challenge webroot до проверки его доступности:

```bash
install -d -m 755 /etc/letsencrypt/coffee-market-calculator-webroot/.well-known/acme-challenge
bash deploy/proxy-append.sh http
printf 'calculator-acme-ok\n' > /etc/letsencrypt/coffee-market-calculator-webroot/.well-known/acme-challenge/coffee-check
curl --fail --silent --show-error http://calc.coffeemarket.kz/.well-known/acme-challenge/coffee-check
```

Ответ должен быть `calculator-acme-ok`. Затем:

```bash
bash deploy/certificates.sh issue
bash deploy/proxy-append.sh tls
curl --fail --silent --show-error https://calc.coffeemarket.kz/api/health/ready
```

Certbot работает в отдельном краткоживущем контейнере, не занимает 80/443 и хранит аккаунт/renewal/certificates в собственном подкаталоге `/etc/letsencrypt/coffee-market-calculator`. Остальные сертификаты/renewal-конфиги не изменяются. Email и условия Let's Encrypt при необходимости подтверждает сам оператор в терминале. Логи/work Certbot изолированы в каталоге калькулятора. Новый Nginx использует стандартные symlink `live/coffee-market-calculator/` внутри этого подкаталога, уже видимого через существующий `/etc/letsencrypt` bind mount.

Маршрут challenge остаётся доступным для продления. TLS-прокси использует Docker DNS с повторным разрешением: отсутствие нового web-контейнера не мешает загрузке старых virtual hosts. IP-rate-limit на `/api/auth/` ограничивает трафик до приложения; приложение дополнительно сохраняет общую квоту в своей БД. Внешняя CDN/trusted client IP интеграция не включается автоматически.

Template изменяется на хосте и переживает пересоздание контейнера. Сохраните добавленные блоки в управляемой конфигурации основного проекта после просмотра diff: его будущий reset/деплой не должен заменять template старой версией. Helper повторно не добавляет существующий marker и не является редактором уже установленного server block. Для смены домена/настройки нужна отдельная контролируемая правка конфигурации.

## Продление и backup

```bash
install -m 644 deploy/coffee-calculator-cert-renew.service /etc/systemd/system/
install -m 644 deploy/coffee-calculator-cert-renew.timer /etc/systemd/system/
install -m 644 deploy/coffee-calculator-backup.service /etc/systemd/system/
install -m 644 deploy/coffee-calculator-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now coffee-calculator-cert-renew.timer coffee-calculator-backup.timer
bash deploy/backup.sh
systemctl list-timers 'coffee-calculator-*' --no-pager
```

Это отдельные новые timer units. Existing Docker/Nginx/боты не перезапускаются. Backup использует custom-format pg_dump только новой БД и создаёт complete `.dump` лишь после успеха; незавершённый файл удаляется. Файлы 0600 находятся в `/var/backups/coffee-market-calculator`; содержат чувствительные auth-токены. Настройте копирование в защищённое внешнее хранилище, проверку восстановления и согласованную retention. Этот helper не удаляет старые backups автоматически. Мониторьте свободное место, доступность URL и failures новых systemd units. Плановую очистку просроченных auth-сессий/аналитики и контактов настраивать по NODE_AUTH/POSTGRESQL/TELEGRAM до реального сбора контактов; Telegram сейчас выключен.

## Обновление и остановка

Перед обновлением сохраните DB backup, конфигурацию/секреты и предыдущую image revision. Переключите исходники на новый проверенный commit. В существующем `compose.env` измените только `CALCULATOR_REVISION`, затем `compose.sh pull calculator-web migrate operator`, выполните migration/grant и `compose.sh up -d --wait calculator-web`. Не запускайте генератор credentials снова. Старая версия образа не отменяет SQL-миграции: rollback БД планируется отдельно.

Временно остановить только калькулятор:

```bash
bash deploy/compose.sh stop calculator-web calculator-db
```

Не используйте глобальные docker prune, остановку Docker daemon, Compose основного сайта или down --volumes для эксплуатационных команд. Volume с БД сохраняется при stop и обычной замене контейнера. Исключение — CI verification на отдельном одноразовом runner: он удаляет только свой тестовый volume.
