import { z } from "zod";
import { isValidPhoneNumber, parsePhoneNumber } from "libphonenumber-js/max";

export const phoneSchema = z
  .string()
  .max(32)
  .refine(
    (value) => value.startsWith("+") && isValidPhoneNumber(value),
    "Введите действительный номер в международном формате",
  )
  .transform((value) => parsePhoneNumber(value).number);

export const CONSENT_VERSION = "pnl-delivery-v1";
export const CONSENT_TEXT =
  "Я передаю Coffee Market свой номер телефона и расчёт для сохранения заявки и получения персонального Excel P&L на 3 месяца в чате менеджера Telegram. Это не согласие на рекламу или звонки.";
