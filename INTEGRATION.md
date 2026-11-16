# Встраивание и перенос 2.1

Основной продукт теперь самостоятельный сайт. Встраиваемый компонент сохранён для будущего подключения к Django.

```sh
npm ci
npm run build:widget
```

Весь widget-dist содержит ES-модули, дополнительные chunks, CSS, HTML-пример и templates/coffee-market-pnl-3-months.xlsx. JS/CSS можно отдавать как статику; Node на production для самого калькулятора не нужен. При этом серверная выдача Excel требует backend и постоянного хранилища.

```html
<link
  rel="stylesheet"
  href="/static/coffee-calculator/coffee-market-calculator.css"
/>
<div id="coffee-calculator"></div>
<script type="module">
  import { mountCoffeeCalculator } from "/static/coffee-calculator/coffee-market-calculator.js";
  mountCoffeeCalculator(document.getElementById("coffee-calculator"), {
    headingLevel: 2,
  });
</script>
```

Calculator не содержит собственные html/body/main, навигацию магазина или футер. CSS Modules и scoped reset защищают форму от обычных глобальных правил. Шрифты встраиваемый вариант наследует от хоста. showIntro:false позволяет использовать заголовок из шаблона. Тема настраивается через --cmc-* CSS variables, sticky отступ через --cmc-sticky-top. Уникальные ID позволяют монтировать несколько экземпляров.

## Django

Используйте существующий base.html, блоки extra_head/content/extra_js и стандартный static tag. При collectstatic/CDN проверьте относительные imports дополнительных JS chunks; файлы нельзя выборочно переименовывать. Публичный каталог передавайте сервером через безопасный json_script либо существующий endpoint. Выбирайте источник каталога внутри монолита, без MCP-посредника. Контракт — src/domain/catalog.ts. В src/widget/index.tsx каталог валидируется до монтирования.

Цены каталога применяются только к совместимому KG/KGS. Другие рынки и валюты дают ручной ввод. В пользовательском каталоге явно указываются масса упаковки и валюта, не извлекайте их из названия товара.

PnlOffer ожидает /api/pnl/config, /api/pnl/requests на origin хоста и пример по /templates/coffee-market-pnl-3-months.xlsx. При копировании шаблона в Django согласуйте этот URL или адаптируйте presentation-компонент; доступ к выдаче отключён, если config endpoint отсутствует. Для backend используйте порт DeliveryRepository и существующие Django services/views/models; не переносите Cloudflare D1 binding в Django.

Нужна проверка на самом магазине: настоящие CSS, CSP, загрузка всех chunks, ссылки, доступность с клавиатуры, мобильная ширина, сохранение сценариев и фактический каталог. Перенос в действующий Django в этой версии не выполнялся.

## Настройки из Django

mountCoffeeCalculator принимает options.settings (PublicSettings): только defaults и content. Передайте валидированный объект через Django json_script, как каталог. Все восемь кодов валют обязательны; точный контракт — src/domain/site-settings.ts. Настройки не содержат секретов или конфигурации менеджера. Без settings виджет использует демонстрационные примеры. Сохранённые сценарии имеют приоритет; явный сброс загружает новые стартовые значения.

Для управления в монолите рекомендуются стандартные Django ModelAdmin + permissions, не отдельная авторизация Sites. Реализуйте SettingsRepository через models/transaction.atomic с compare-and-set по revision; shared schemas/formulas остаются спецификацией и покрываются тестами соответствия. Границы авторизации, миграции и пример последовательности переноса — docs/ADMIN.md.
