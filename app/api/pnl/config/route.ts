import { getDeliveryRuntime } from "../../../../src/server/runtime";
import { json } from "../../../../src/server/delivery";

export function GET() {
  const configured = getDeliveryRuntime() !== null;
  return json({
    ready: configured,
    message: configured
      ? "Получите персональный P&L на 3 месяца в чате менеджера Telegram"
      : "Отправка в Telegram пока не подключена. Калькулятор работает без регистрации.",
  });
}
