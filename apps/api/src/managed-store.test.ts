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
});
