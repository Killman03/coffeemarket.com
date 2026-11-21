import { describe, expect, it } from "vitest";
import {
  adminPasswordSchema,
  adminReturnPath,
  ownerCredentialsSchema,
} from "./admin-auth";

describe("administrator credentials and navigation", () => {
  it("limits password size and normalizes operator email addresses", () => {
    expect(adminPasswordSchema.safeParse("short").success).toBe(false);
    expect(adminPasswordSchema.safeParse("a".repeat(129)).success).toBe(false);
    expect(
      ownerCredentialsSchema.parse({
        email: "OWNER@example.com",
        name: " Owner ",
        password: "a".repeat(12),
      }),
    ).toMatchObject({ email: "owner@example.com", name: "Owner" });
  });
  it("allows only known administration destinations", () => {
    expect(adminReturnPath("/admin/analytics")).toBe("/admin/analytics");
    for (const value of [
      "//evil.example",
      "https://evil.example",
      "/api/auth/sign-out",
      "/admin?next=//evil.example",
      null,
    ])
      expect(adminReturnPath(value)).toBe("/admin");
  });
});
