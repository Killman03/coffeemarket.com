import { z } from "zod";

export const adminPasswordPolicy = { minLength: 12, maxLength: 128 } as const;
export const adminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
export const adminPasswordSchema = z
  .string()
  .min(adminPasswordPolicy.minLength)
  .max(adminPasswordPolicy.maxLength);
export const adminSignInSchema = z.object({
  email: adminEmailSchema,
  password: z
    .string()
    .min(1, "Введите пароль")
    .max(adminPasswordPolicy.maxLength),
});
export const ownerCredentialsSchema = z.object({
  email: adminEmailSchema,
  name: z.string().trim().min(1).max(100),
  password: adminPasswordSchema,
});

/** Restricts login destinations to the two existing administration pages. */
export function adminReturnPath(value: unknown): string {
  return value === "/admin/analytics" ? value : "/admin";
}
