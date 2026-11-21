import "dotenv/config";
import { input, password, confirm } from "@inquirer/prompts";
import { z } from "zod";
import { createPostgresDatabase } from "../src/server/postgres/database";
import {
  createOwner,
  resetOwnerPassword,
  revokeOwnerSessions,
} from "../src/server/node/owner-management";
import {
  adminEmailSchema,
  adminPasswordSchema,
} from "../src/domain/admin-auth";

/** Runs explicit operator commands using masked terminal input and a separate DB role. */
async function main() {
  const command = z
    .enum(["create", "reset-password", "revoke-sessions"])
    .parse(process.argv[2]);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Команда требует интерактивный терминал; пароль не принимается через аргументы или env.",
    );
  const connectionString = z
    .url({ protocol: /^(postgres|postgresql)$/ })
    .parse(process.env.ADMIN_DATABASE_URL);
  const { db, pool } = createPostgresDatabase({ connectionString, max: 1 });
  try {
    if (command === "revoke-sessions") {
      if (
        !(await confirm({
          message: "Завершить все сессии владельца?",
          default: false,
        }))
      )
        return;
      await revokeOwnerSessions(db);
    } else {
      const email = await input({
        message: "Email владельца:",
        validate: (value) =>
          adminEmailSchema.safeParse(value).success ||
          "Введите корректный email.",
      });
      const name =
        command === "create"
          ? await input({
              message: "Имя в панели:",
              validate: (value) =>
                (value.trim().length > 0 && value.trim().length <= 100) ||
                "От 1 до 100 символов.",
            })
          : "";
      const value = await password({
        message: "Пароль (12–128 символов):",
        mask: "*",
        validate: (value) =>
          adminPasswordSchema.safeParse(value).success ||
          "От 12 до 128 символов.",
      });
      await password({
        message: "Повторите пароль:",
        mask: "*",
        validate: (confirmation) =>
          confirmation === value || "Пароли не совпадают.",
      });
      if (command === "create")
        await createOwner(db, { email, name, password: value });
      else await resetOwnerPassword(db, email, value);
    }
    console.log(
      "Готово. Изменение сохранено в PostgreSQL и журнале безопасности.",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Database errors and validation objects may contain parameters or credentials.
  if (error instanceof Error && error.name === "ExitPromptError")
    console.error("Операция отменена.");
  else
    console.error(
      "Команда не выполнена. Проверьте миграции, ADMIN_DATABASE_URL, права роли и существующего владельца. Данные не выводятся.",
    );
  process.exitCode = 1;
});
