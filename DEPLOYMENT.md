# Развёртывание 2.0

## Sites

Существующий project_id сохраняется в .openai/hosting.json. Manifest объявляет PNL_DB как D1 binding; R2 не используется. SQL и journal Drizzle находятся в drizzle. Sites применяет миграции при публикации. Предыдущие миграции неизменяемы.

Сборка: npm ci, npm test, npm run typecheck, npm run build. Исходники синхронизируются source helper Sites, который коммитит, отправляет точное состояние и пакует build. Публикуется archive из того же commit_sha. Существующая аудитория сохраняется.

В production не заданы Telegram secrets: GET /api/pnl/config возвращает ready:false. POST /api/pnl/requests и webhook возвращают 503 без сбора контактов. Это намеренное состояние до подключения менеджера.

## Обычный Node.js

```sh
npm ci
npm run build:portable
npm run start:portable
```

Next standalone содержит public и .next-node/static благодаря scripts/prepare-standalone.mjs. Dockerfile использует стандартный multistage Node image и непривилегированного пользователя. На любом хостинге доступны калькулятор и пример Excel. Production Telegram требует собственного постоянного адаптера DeliveryRepository и composition root: D1 bindings не появляются автоматически в Node. Контракты и SQL инварианты описаны в docs/TELEGRAM.md.

## Подключение менеджера позже

Не помещать секреты в .openai/hosting.json, Git, клиентские переменные NEXT_PUBLIC_* или URL. В Sites задать server-only environment через штатный инструмент; на другом хостинге — secret manager окружения. Имена:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- TELEGRAM_MANAGER_USERNAME либо TELEGRAM_MANAGER_PHONE
- TELEGRAM_MANAGER_USER_ID
- TELEGRAM_BUSINESS_CONNECTION_ID
- PNL_PUBLIC_ORIGIN

Нужно подключить бизнес-бота к личному аккаунту менеджера с правом отвечать, установить webhook и настроить ежедневную очистку до реального сбора. Полный порядок и официальный API — docs/TELEGRAM.md. Интерфейс включит форму только после корректной конфигурации. Бот не отправляет обычные рекламные сообщения; выдача запускается только явным запросом пользователя.

## Локальная БД

После изменения db/schema.ts выполнить npm run db:generate и проверить сгенерированные миграции. Для preview применять SQL к локальной D1 стандартным Wrangler migrations apply с binding PNL_DB и migrations_dir=drizzle; production и local — отдельные базы. SQL не создаётся при HTTP-запросе. В тестах тот же SQL выполняется настоящим SQLite, а не только моками.

## Зависимости

package-lock.json обязателен. npm overrides обновляют uuid у ExcelJS до совместимого CommonJS-релиза 11.1.1+ (используется v4) и esbuild у @esbuild-kit/core-utils до исправленной 0.25.x. Эти ограничения — стандартные настройки npm, проверенные сборкой, генерацией миграций и тестами. Drizzle ORM обновлён до исправленной 0.45.4. Не использовать npm audit fix --force или замены API библиотек.
