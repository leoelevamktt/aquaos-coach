import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedStore, parseDelimited } from "./managed-store.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("ManagedStore", () => {
  it("persiste criação, edição, exclusão e auditoria", () => {
    const directory = mkdtempSync(join(tmpdir(), "aquaos-store-"));
    directories.push(directory);
    const file = join(directory, "data.json");
    const store = new ManagedStore(file);
    const created = store.create("groups", { name: "Velocistas", status: "active" });
    expect(store.update("groups", created.id, { members: 8 })?.members).toBe(8);
    expect(new ManagedStore(file).get("groups", created.id)?.name).toBe("Velocistas");
    expect(store.remove("groups", created.id)?.id).toBe(created.id);
    expect(store.audit().map((entry) => entry.action)).toEqual(expect.arrayContaining(["create", "update", "delete"]));
  });

  it("interpreta CSV com vírgula ou ponto e vírgula", () => {
    expect(parseDelimited("name,email\nAna,ana@example.com")).toEqual([{ name: "Ana", email: "ana@example.com" }]);
    expect(parseDelimited("name;group\nCaio;Elite")).toEqual([{ name: "Caio", group: "Elite" }]);
    expect(parseDelimited('name,notes\nAna,"ritmo, técnica e virada"\nCaio,"linha 1\nlinha 2"')).toEqual([
      { name: "Ana", notes: "ritmo, técnica e virada" },
      { name: "Caio", notes: "linha 1\nlinha 2" },
    ]);
  });

  it("publica eventos com o registro alterado para consumidores em tempo real", () => {
    const directory = mkdtempSync(join(tmpdir(), "aquaos-events-"));
    directories.push(directory);
    const store = new ManagedStore(join(directory, "data.json"));
    const events: Array<{ action: string; resource: string; record?: { name?: string } }> = [];
    const unsubscribe = store.subscribe((event) => events.push(event));
    const created = store.create("groups", { name: "Velocistas", status: "active" });
    store.update("groups", created.id, { name: "Velocistas elite" });
    store.remove("groups", created.id);
    unsubscribe();
    expect(events.map((event) => event.action)).toEqual(["create", "update", "delete"]);
    expect(events[1]?.record?.name).toBe("Velocistas elite");
  });

  it("calcula a visão analítica pela janela solicitada", () => {
    const directory = mkdtempSync(join(tmpdir(), "aquaos-analytics-"));
    directories.push(directory);
    const store = new ManagedStore(join(directory, "data.json"));
    store.create("workouts", { title: "Teste de volume", date: new Date().toISOString().slice(0, 10), distanceMeters: 1800, zone: "A1", status: "published" });
    const overview = store.analytics(4);
    expect(overview.windowWeeks).toBe(4);
    expect(overview.metrics.activeAthletes).toBe(4);
    expect(overview.metrics.plannedMeters).toBeGreaterThanOrEqual(1800);
    expect(overview.weekly).toHaveLength(4);
  });
});
