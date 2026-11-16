// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  claimAdmin,
  getAdminAccess,
  handleAdminSettings,
  type AdminDependencies,
} from "./admin";
import { createDefaultSettings } from "../application/site-settings";

function setup(owner: string | null = "owner-subject") {
  const initial = {
    settings: createDefaultSettings(),
    revision: 0,
    updatedAt: null,
  };
  const repository = {
    get: vi.fn().mockResolvedValue(initial),
    getOwner: vi.fn().mockResolvedValue(owner ? { subject: owner } : null),
    claimOwner: vi.fn().mockResolvedValue(true),
    save: vi
      .fn()
      .mockImplementation(async (settings) => ({
        settings,
        revision: 1,
        updatedAt: 100,
      })),
  };
  const deps: AdminDependencies = {
    repository,
    user: {
      userId: "owner-subject",
      email: "owner@example.com",
      displayName: "Owner",
    },
    bootstrapEmail: "owner@example.com",
    origin: "https://example.com",
    deliveryStatus: { deliveryReady: false, missing: ["Токен бизнес-бота"] },
  };
  return { deps, repository, initial };
}
function request(
  body: unknown,
  headers: Record<string, string> = {},
  method = "PUT",
) {
  return new Request("https://example.com/api/admin/settings", {
    method,
    headers: {
      origin: "https://example.com",
      "X-CoffeeMarket-Admin": "1",
      "content-type": "application/json",
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("admin authorization and mutations", () => {
  it("never authorizes anonymous users or an unrelated authenticated subject", async () => {
    const { deps, repository } = setup();
    expect(
      await handleAdminSettings(request(null, {}, "GET"), {
        ...deps,
        user: null,
      }),
    ).toHaveProperty("status", 401);
    expect(
      await handleAdminSettings(request(null, {}, "GET"), {
        ...deps,
        user: { ...deps.user!, userId: "attacker" },
      }),
    ).toHaveProperty("status", 403);
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it("pins the subject after bootstrap rather than treating email as permanent authorization", async () => {
    const { deps } = setup();
    expect(
      await getAdminAccess({
        ...deps,
        user: { ...deps.user!, userId: "different-subject" },
      }),
    ).toBe("forbidden");
    expect(
      await getAdminAccess({
        ...deps,
        user: { ...deps.user!, email: "new-address@example.com" },
      }),
    ).toBe("authorized");
  });
  it("only the verified initial owner can claim and GET access does not claim", async () => {
    const { deps, repository } = setup(null);
    expect(await getAdminAccess(deps)).toBe("bootstrap");
    expect(repository.claimOwner).not.toHaveBeenCalled();
    expect(
      (await handleAdminSettings(request(null, {}, "GET"), deps)).status,
    ).toBe(403);
    expect(
      (
        await claimAdmin(request({}), {
          ...deps,
          user: { ...deps.user!, email: "other@example.com" },
        })
      ).status,
    ).toBe(403);
    expect((await claimAdmin(request({}), deps)).status).toBe(200);
    expect(repository.claimOwner).toHaveBeenCalledWith(
      "owner-subject",
      expect.any(Number),
    );
  });
  it("rejects cross-origin writes, missing custom header and hostile fetch-site before database access", async () => {
    const { deps, repository, initial } = setup();
    for (const headers of [
      { origin: "https://evil.example" },
      { "X-CoffeeMarket-Admin": "" },
      { "sec-fetch-site": "cross-site" },
      { origin: "null" },
    ] as Record<string, string>[]) {
      expect(
        (await handleAdminSettings(request(initial, headers), deps)).status,
      ).toBe(403);
      expect((await claimAdmin(request({}, headers), deps)).status).toBe(403);
    }
    expect(repository.getOwner).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it("validates complete schemas, content types and bounded bodies", async () => {
    const { deps, repository } = setup();
    for (const [body, headers] of [
      [
        { revision: 0, settings: { telegram: { managerUsername: "oops" } } },
        {},
      ],
      ["x".repeat(70_000), {}],
      [{}, { "content-type": "text/plain" }],
    ] as const) {
      expect(
        (await handleAdminSettings(request(body, headers), deps)).status,
      ).toBe(400);
    }
    expect(repository.save).not.toHaveBeenCalled();
  });
  it("saves normalized settings with the authenticated actor and returns no-store", async () => {
    const { deps, repository, initial } = setup();
    initial.settings.telegram.managerUsername = "@coffee_manager";
    const response = await handleAdminSettings(
      request({ revision: 0, settings: initial.settings }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        telegram: expect.objectContaining({
          managerUsername: "coffee_manager",
        }),
      }),
      0,
      "owner-subject",
      expect.any(Number),
    );
  });
  it("does not enable delivery when server dependencies are missing", async () => {
    const { deps, repository, initial } = setup();
    initial.settings.telegram.managerUsername = "coffee_manager";
    initial.settings.telegram.enabled = true;
    expect(
      (
        await handleAdminSettings(
          request({ revision: 0, settings: initial.settings }),
          deps,
        )
      ).status,
    ).toBe(422);
    expect(repository.save).not.toHaveBeenCalled();
    expect(
      (
        await handleAdminSettings(
          request({ revision: 0, settings: initial.settings }),
          { ...deps, deliveryStatus: { deliveryReady: true, missing: [] } },
        )
      ).status,
    ).toBe(200);
  });
  it("returns conflict on stale revision without pretending the save succeeded", async () => {
    const { deps, repository, initial } = setup();
    repository.save.mockResolvedValueOnce(null);
    expect(
      (
        await handleAdminSettings(
          request({ revision: 0, settings: initial.settings }),
          deps,
        )
      ).status,
    ).toBe(409);
  });
  it("fails closed on storage errors and omits internal error details", async () => {
    const { deps, repository } = setup();
    repository.getOwner.mockRejectedValue(new Error("private token details"));
    const response = await handleAdminSettings(request(null, {}, "GET"), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
    expect(await getAdminAccess(null)).toBe("unconfigured");
  });
});
