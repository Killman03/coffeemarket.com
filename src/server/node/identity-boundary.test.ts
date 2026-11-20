// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createNodeRuntime } from "./bootstrap";
import { runWithApplicationRuntime } from "../runtime-context";
import { getAdminDependencies } from "../../../app/admin/dependencies";
import { getChatGPTUser } from "../../../app/chatgpt-auth";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "oai-authenticated-user-id": "forged-owner",
      "oai-authenticated-user-email": "owner@example.com",
    }),
}));

describe("Node identity boundary", () => {
  it("never trusts Sites identity headers on the Node.js server", async () => {
    const demo = await createNodeRuntime({ STORAGE_DRIVER: "demo" });
    await runWithApplicationRuntime({ ...demo, platform: "node" }, async () => {
      expect(await getChatGPTUser()).toBeNull();
      expect(await getAdminDependencies()).toBeNull();
    });
  });
});
