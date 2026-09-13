import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedStore, statusHasToken } from "./managed-store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("ManagedStore — correções de reconciliação canônica", () => {
  it("numberValue converte string vazia para null (não para 0) nas sessões canônicas", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-numval-"));
    directories.push(directory);
    const store = new ManagedStore(join(directory, "data.json"));
    await store.initialize();
    // loadPse vazio na fonte (coluna load_pse) não pode virar 0
    const session = store.get("trainingSessions", "RKF-10-12-01");
    expect(session).toBeDefined();
    expect(session?.loadPse).toBeNull();
    expect(session?.proposedDistanceMeters).toBe(3600);
  });

  it("reconhece apenas tokens de status completos", () => {
    expect(statusHasToken("READY_WHOLE|BLOCKS_EXACT", "READY_WHOLE")).toBe(true);
    expect(statusHasToken("READY_WHOLE|BLOCKS_EXACT", "READY")).toBe(false);
    expect(statusHasToken("NOT_READY", "READY")).toBe(false);
    expect(statusHasToken("NOT_EXACT", "EXACT")).toBe(false);
  });

  it("status por token exato: machine_status READY_ATIVIDADE NÃO marca como ready", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rkf-status-"));
    directories.push(directory);
    const store = new ManagedStore(join(directory, "data.json"));
    await store.initialize();
    const tokens = new Map<string, string>();
    for (const record of store.list("trainingSessions")) tokens.set(String(record.machineStatus), String(record.status));
    for (const record of store.list("sessionBlocks")) tokens.set(String(record.machineStatus), String(record.status));
    for (const [machineStatus, status] of tokens) {
      const ready = machineStatus.split(/[|;,]+/).map((token) => token.trim()).includes("READY");
      expect(status === "ready" || !ready, `machine_status=${machineStatus} status=${status}`).toBe(true);
    }
  });
});
