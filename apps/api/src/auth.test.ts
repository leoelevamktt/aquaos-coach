import { describe, expect, it } from "vitest";
import { login } from "./auth.js";

describe("demo authentication", () => {
  it("authenticates the athlete by e-mail or formatted CPF", () => {
    expect(login("ana@natacao.local", "natacao-demo")?.user.role).toBe("athlete");
    expect(login("123.456.789-00", "natacao-demo")?.user.role).toBe("athlete");
    expect(login("12345678900", "natacao-demo")?.user.role).toBe("athlete");
  });

  it("rejects an invalid password", () => {
    expect(login("123.456.789-00", "senha-incorreta")).toBeUndefined();
  });
});
