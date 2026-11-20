# Серверная версия с PostgreSQL

## Что реализовано

PostgreSQL хранит настройки, собственную аналитику и подготовленные заявки на P&L. Интерфейс, рынки, валюты, формулы калькулятора и Excel сохранены. Три репозитория реализуют прежние порты через Drizzle/node-postgres. Sites использует свои D1-адаптеры отдельно; существующий сайт и Django автоматически не переключаются.

Независимая авторизация — следующий отдельный этап. На Node.js админка и её API закрыты, заголовки oai-authenticated-user-* не дают доступ. Публичный сбор аналитики работает независимо от админки; просмотр отчётов и редактирование настроек через UI требуют identity-адаптера. До этого посещения владельца на Node не исключаются по аккаунту.

Хранилище Telegram реализовано, но бот и менеджер не подключены, выдача выключена. До сбора контактов нужны авторизация, конфигурация менеджера, доверенный reverse proxy и регулярная очистка. Приложение не имитирует работающую доставку.

## Архитектура

- `src/server/settings-contracts.ts`, `analytics-contracts.ts`, `contracts.ts` — независимые порты.
- `src/server/postgres/` — три PostgreSQL-адаптера и создание ограниченного пула.
- `db/postgres/schema.ts`, `drizzle-postgres/` — отдельная схема и сгенерированные миграции PostgreSQL.
- `instrumentation.ts`, `src/server/node/` — штатный Next.js startup hook, Zod-конфигурация и composition root.
- `src/server/runtime-context.ts` — процессный Node runtime, общий для instrumentation/route bundles; request-local AsyncLocalStorage для Sites.
- `src/server/sites-runtime.ts` — сборка D1-адаптеров из hosting bindings.
- `src/server/analytics-report.ts`, `settings-contracts.ts` — общие преобразования/проверки без копирования логики для каждого диалекта.

Пул один на процесс, не на запрос. По умолчанию максимум 10 соединений, ожидание подключения и блокировки 5 секунд, SQL timeout 10 секунд. PG_POOL_MAX умножается на число процессов/реплик. Ошибки пула не выводят credentials. Runtime.close освобождает пул; instrumentation регистрирует закрытие на SIGTERM/SIGINT, HTTP shutdown остаётся в ведении Next.js.

## Запуск

Нужны Node.js из `.node-version` и отдельная PostgreSQL-база. Проверено на PostgreSQL 17. Существующая база Django не используется.

1. Выполнить npm ci.
2. Создать отдельную базу и роли. Локально скопировать `.env.example` в `.env` и указать свои реквизиты. На сервере использовать service manager/Docker runtime environment или secrets.
3. Применить миграции одной release-job с DDL-учётной записью до запуска новых реплик.
4. Собрать и запустить приложение с рабочей DML-учётной записью.

```sh
npm run db:postgres:migrate
npm run build:portable
npm run start:portable
```

Next dev читает .env штатно; start:portable использует стандартный Node --env-file-if-exists=.env. Drizzle Kit читает .env через dotenv. Переданные переменные окружения имеют приоритет. Секреты не должны попадать в Docker build context или NEXT_PUBLIC_*.

| Переменная             | Назначение                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| STORAGE_DRIVER         | postgres для постоянного хранения или demo для калькулятора без БД                            |
| DATABASE_URL           | PostgreSQL URI рабочего пользователя, только на сервере                                       |
| SITE_ORIGIN            | Точный HTTPS origin без пути/завершающего слеша; HTTP разрешён только для локального loopback |
| PG_POOL_MAX            | 1–100, по умолчанию 10 на процесс                                                             |
| MIGRATION_DATABASE_URL | Отдельный DDL URI для Drizzle Kit; при отсутствии используется DATABASE_URL                   |

Без STORAGE_DRIVER сохраняется прежний demo. Если одновременно указан DATABASE_URL, конфигурация отвергается, чтобы не скрывать ошибку. Docker runner по умолчанию требует postgres. В PostgreSQL-режиме неверная конфигурация, недоступная БД или неприменённая схема останавливают startup; незаметного перехода на память нет. Startup проверяет необходимые таблицы и колонки, не выполняет DDL и не создаёт настройки при GET.

Для внешней БД использовать TLS с проверкой сертификата штатными URI-параметрами pg, например sslmode=verify-full и доверенный CA. Код не отключает проверку сертификатов.

```text
GET /api/health/ready
200 {"ready":true,"storage":"postgres"}
```

При ошибке БД readiness возвращает 503 без подробностей подключения. Demo явно указывает storage=demo.

## Миграции и права

`drizzle/`, `drizzle.config.ts` и `db/schema.ts` по-прежнему относятся к D1/SQLite и сохранены. Не применять их к PostgreSQL.

```sh
npm run db:postgres:generate
npm run db:postgres:check
npm run db:postgres:migrate
```

SQL и snapshots версионируются вместе с кодом; применённые миграции не изменять. Мигратор — штатный Drizzle Kit, journal — drizzle.__drizzle_migrations. Не запускать несколько migration-job одновременно. Генерация/проверка истории не требуют активного соединения; применение требует DDL-прав.

Production использует владельца схемы coffee_migrator и рабочую роль coffee_app без superuser/CREATEDB. После применения миграций владелец схемы выдаёт права в целевой базе; роли и пароли администратор создаёт отдельно:

```sql
GRANT CONNECT ON DATABASE coffee_market TO coffee_app;
GRANT USAGE ON SCHEMA public TO coffee_app;
GRANT SELECT, INSERT ON site_owner, site_settings_audit TO coffee_app;
GRANT SELECT, INSERT, UPDATE ON site_settings TO coffee_app;
GRANT SELECT, INSERT, DELETE ON analytics_events TO coffee_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_sessions, pnl_requests, pnl_updates TO coffee_app;
```

Новым таблицам нужны review и соответствующие GRANT. Runtime не читает migration journal. Роли, пароли, сеть, резервные копии не создаются SQL-миграцией приложения; эти команды не исполнялись на пользовательском сервере.

## Гарантии

Настройки используют row lock/CAS по revision и атомарную транзакцию с аудитом. Конкурирующий первый INSERT имеет одного победителя; проигравшая запись не создаёт аудит. Коррумпированные документы отклоняются Zod. В PostgreSQL JSON хранится как jsonb, timestamps/Telegram IDs как bigint с number mapping, session/event IDs как UUID.

Для агрегатных квот применяются transaction-scoped advisory locks: namespace 21081, ресурс 1 — аналитика, 2 — создание заявки. Lock берётся отдельным statement до счётчиков под READ COMMITTED: ожидающая реплика видит commit предыдущей. Квоты сохраняются между процессами; reverse proxy всё равно должен ограничивать публичный трафик.

Отчёты используют READ ONLY REPEATABLE READ: все таблицы/счётчики читаются из одного снимка, дни считаются в UTC независимо от timezone БД. Сборка/валидация отчёта общая с D1. Подтверждённые выдачи берутся из delivery-таблиц. Повтор события не продлевает активность и не создаёт сессию. FK каскадно удаляет события с сессией и обнуляет её ссылку у заявки.

На Node без доверенного proxy-адаптера заявки разделяют conservative anonymous-квоту. Подмена cf-connecting-ip её не обходит. Sites получает адрес только через свой hosting adapter. Перед включением реальной выдачи завершить конфигурацию trusted reverse proxy.

## Docker

```sh
docker build --target migrator -t coffee-market-migrator:server .
docker build --target runner -t coffee-market-server:server .
```

Образы используют Node 24.19.0. Мигратор содержит Drizzle Kit и SQL; runner содержит standalone, работает непривилегированным пользователем и имеет readiness healthcheck. URI мигратора и runtime передаются при запуске в сети БД. PostgreSQL и порт приложения не открывать напрямую в интернет; HTTPS обслуживает существующий reverse proxy. Поднять мигратор одной release-job, затем реплики приложения.

## Проверки

```sh
npm test
npm run typecheck
npm run build:portable
npm run test:postgres
```

Для последней команды задать TEST_DATABASE_URL отдельного тестового PostgreSQL с CREATEDB. Suite создаёт собственную БД с генерируемым именем, применяет настоящие миграции и удаляет только её. Данные исходной базы не очищаются. Production URI для тестов не использовать. Без переменной suite завершается ошибкой, а не пропускает проверки. После аварийного завершения временная БД может остаться — удалять только после проверки её принадлежности тестам.

Интеграционные тесты проверяют реальные гонки между двумя пулами, откаты, квоты, дедупликацию, bigint IDs, FK/retention, повтор миграций, паритет D1/PostgreSQL. Реальный Next standalone проверяется через HTTP: readiness, сохранённый заголовок, запись события, отказ forged owner headers, повторный startup с прежними данными. CI также собирает оба Docker target, применяет миграции контейнером и проверяет readiness приложения.

## Данные и эксплуатация

Этот этап не импортирует D1 и не подключает Django. Перед переключением сделать backup и отдельно перенести нужные настройки/аналитику, сверив результаты. Subject владельца Sites нельзя использовать как авторизацию Node. Старый образ не отменяет применённую SQL-миграцию; откат БД планировать отдельно.

Очистка аналитики пока bounded/opportunistic при ingest/report. Строгий purge без трафика требует планировщика. DeliveryRepository сохраняет очистку контактов через 30 дней и update IDs через 7 дней. Планировщик, off-server backups с проверкой восстановления и мониторинг настроить до реального сбора контактов; этот код их автоматически не создаёт.

Официальные контракты: [Drizzle/node-postgres](https://orm.drizzle.team/docs/get-started-postgresql), [транзакции](https://orm.drizzle.team/docs/transactions), [пул](https://node-postgres.com/features/pooling), [Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
