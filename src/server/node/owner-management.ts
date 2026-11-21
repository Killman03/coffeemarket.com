import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import {
  authAccount,
  authAudit,
  authSession,
  authUser,
} from "../../../db/postgres/auth-schema";
import { siteOwner } from "../../../db/postgres/schema";
import {
  ownerCredentialsSchema,
  adminEmailSchema,
  adminPasswordSchema,
} from "../../domain/admin-auth";
import type { PostgresDatabase } from "../postgres/database";
import { ownerManagementLock } from "./owner-lock";

// Serializes all operator commands across machines, including the empty-owner
// case where SELECT FOR UPDATE alone cannot lock a missing singleton row.

/** Provisions the only owner atomically, without a public registration endpoint.
 *
 * Args:
 *   db: Operator's PostgreSQL connection with provisioning privileges.
 *   input: Email, display name and plaintext password held only in memory.
 *
 * Returns:
 *   Newly pinned user ID; no password or hash is returned.
 *
 * Raises:
 *   Error: An owner already exists or provisioning fails; writes are rolled back.
 */
export async function createOwner(
  db: PostgresDatabase,
  input: unknown,
): Promise<string> {
  const values = ownerCredentialsSchema.parse(input);
  const password = await hashPassword(values.password);
  const id = crypto.randomUUID();
  return db.transaction(async (tx) => {
    await tx.execute(ownerManagementLock);
    if ((await tx.select().from(siteOwner).limit(1)).length)
      throw new Error("Владелец уже создан. Повторная активация запрещена.");
    await tx
      .insert(authUser)
      .values({ id, name: values.name, email: values.email });
    await tx
      .insert(authAccount)
      .values({
        id: crypto.randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password,
      });
    await tx
      .insert(siteOwner)
      .values({ id: 1, subject: id, createdAt: Date.now() });
    await tx
      .insert(authAudit)
      .values({
        id: crypto.randomUUID(),
        subject: id,
        action: "owner_created",
      });
    return id;
  });
}

/** Changes only the pinned owner's password and immediately revokes all sessions.
 *
 * Args:
 *   db: Operator connection; runtime credentials need no provisioning privileges.
 *   email: Existing owner's normalized email, checked against the pinned ID.
 *   password: New password satisfying the shared policy.
 *
 * Raises:
 *   Error: The requested account is not the pinned owner or credentials are absent.
 */
export async function resetOwnerPassword(
  db: PostgresDatabase,
  email: string,
  password: string,
): Promise<void> {
  const normalized = adminEmailSchema.parse(email);
  const hash = await hashPassword(adminPasswordSchema.parse(password));
  await db.transaction(async (tx) => {
    await tx.execute(ownerManagementLock);
    const [owner] = await tx
      .select({ id: authUser.id })
      .from(siteOwner)
      .innerJoin(authUser, eq(siteOwner.subject, authUser.id))
      .where(eq(authUser.email, normalized));
    if (!owner) throw new Error("Аккаунт владельца не найден.");
    const changed = await tx
      .update(authAccount)
      .set({ password: hash, updatedAt: new Date() })
      .where(
        and(
          eq(authAccount.userId, owner.id),
          eq(authAccount.providerId, "credential"),
        ),
      )
      .returning({ id: authAccount.id });
    if (changed.length !== 1)
      throw new Error("Учётные данные владельца повреждены.");
    await tx.delete(authSession).where(eq(authSession.userId, owner.id));
    await tx
      .insert(authAudit)
      .values({
        id: crypto.randomUUID(),
        subject: owner.id,
        action: "password_reset",
      });
  });
}

/** Revokes every owner session and records the operator action atomically. */
export async function revokeOwnerSessions(db: PostgresDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(ownerManagementLock);
    const [owner] = await tx.select().from(siteOwner).limit(1);
    if (!owner) throw new Error("Владелец не создан.");
    await tx.delete(authSession).where(eq(authSession.userId, owner.subject));
    await tx
      .insert(authAudit)
      .values({
        id: crypto.randomUUID(),
        subject: owner.subject,
        action: "sessions_revoked",
      });
  });
}
