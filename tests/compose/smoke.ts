import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { settingsEnvelopeSchema } from "../../src/domain/site-settings";
import { createPostgresDatabase } from "../../src/server/postgres/database";
import {
  createOwner,
  resetOwnerPassword,
} from "../../src/server/node/owner-management";

// Explicit CI-only fixture: never make an account through a production command.
assert.equal(process.env.CI, "true");
const operator = createPostgresDatabase({
  connectionString: process.env.ADMIN_DATABASE_URL,
  max: 1,
});
const origin = "http://127.0.0.1:3107";
const internal = "http://calculator-web:3000";
const email = "compose-owner@example.com",
  password = randomBytes(24).toString("base64url");
try {
  await createOwner(operator.db, {
    email,
    password,
    name: "Compose verification",
  });
  const request = (route: string, init?: RequestInit) =>
    fetch(`${internal}${route}`, {
      ...init,
      headers: { host: "127.0.0.1:3107", ...init?.headers },
    });
  assert.equal((await request("/api/admin/settings")).status, 401);
  const login = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const read = await request("/api/admin/settings", { headers: { cookie } });
  assert.equal(read.status, 200);
  const envelope = settingsEnvelopeSchema.parse(await read.json());
  envelope.settings.content.calculatorTitle = "Compose isolation verified";
  const write = await request("/api/admin/settings", {
    method: "PUT",
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "x-coffeemarket-admin": "1",
    },
    body: JSON.stringify({
      revision: envelope.revision,
      settings: envelope.settings,
    }),
  });
  assert.equal(write.status, 200);
  assert.match(await (await request("/")).text(), /Compose isolation verified/);
  await resetOwnerPassword(
    operator.db,
    email,
    randomBytes(24).toString("base64url"),
  );
  assert.equal(
    (await request("/api/admin/settings", { headers: { cookie } })).status,
    401,
  );
  console.log(
    "Compose smoke passed: restricted roles, auth, settings/audit and revocation.",
  );
} finally {
  await operator.pool.end();
}
