import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachAuthStore, login, logout } from "./auth.js";
import { ManagedStore } from "./managed-store.js";

describe("demo authentication", () => {
  it("authenticates the athlete by e-mail or formatted CPF", async () => {
    expect((await login("ana@natacao.local", "natacao-demo"))?.user.role).toBe("athlete");
    expect((await login("123.456.789-00", "natacao-demo"))?.user.role).toBe("athlete");
    expect((await login("12345678900", "natacao-demo"))?.user.role).toBe("athlete");
  });

  it("rejects an invalid password", async () => {
    expect(await login("123.456.789-00", "senha-incorreta")).toBeUndefined();
  });

  it("persists only the session token hash and supports shared lookup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-auth-"));
    const managed = new ManagedStore(join(directory, "auth.json"));
    await managed.initialize();
    attachAuthStore(managed);
    const result = await login("ana@natacao.local", "natacao-demo");
    expect(result).toBeDefined();
    const hash = createHash("sha256").update(result!.token).digest("hex");
    expect(managed.get("authSessions", result!.token)).toBeUndefined();
    expect((await managed.getAuthSession(hash))?.user).toMatchObject({ role: "athlete", athleteId: "ana-souza" });
    await logout(result!.token);
    await managed.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
