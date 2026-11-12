# Coffee Market — калькулятор и P&L на 3 месяца

Версия 2.0.0. Самостоятельный русскоязычный сайт: рынок и валюта выбираются независимо. Калькулятор бесплатен, без регистрации. Excel дополняет расчёт меню, сценариями и планом/фактом.

## Запуск

```sh
npm ci
npm test
npm run typecheck
npm run dev
```

Node.js согласно engines в package.json; зависимости зафиксированы package-lock.json. Google-style docstrings описывают публичные границы.

## Сборки

- `npm run build` — Sites / Worker.
- `npm run build:portable` и `npm run start:portable` — обычный Node.js / Next.js standalone.
- `npm run build:widget` — независимый ESM-виджет в widget-dist.
- `npm run db:generate` — новые SQL-миграции из схемы Drizzle; ранее применённые миграции не изменять.

## Документация

- ARCHITECTURE.md — слои, контракты, рынки, сценарии и формулы.
- DEPLOYMENT.md — размещение и настройки окружения.
- INTEGRATION.md — встраивание и Django.
- docs/TELEGRAM.md — автоматическая выдача из личного чата менеджера.
- scripts/workbook/README.md — структура Excel, авторинг и воспроизведение проверок.
- VALIDATION.md — выполненные проверки и ограничения.

Выдача персонального Excel остаётся отключённой до настройки бизнес-бота, хранилища, webhook и менеджера. На сайте доступен реальный демонстрационный XLSX; телефоны при отключённой выдаче не собираются. Установка исходников сама по себе не подключает Telegram.
