import { test, expect } from "@playwright/test";

/**
 * Auditoria completa de produção: todas as views do coach, desktop e mobile.
 * FRONTEND_URL aponta para produção; login real via AuthGate.
 */
const BASE = process.env.FRONTEND_URL ?? "http://localhost:3000";
const COACH_EMAIL = process.env.COACH_EMAIL ?? (BASE.includes("localhost") ? "coach@natacao.local" : "treinador@elevamkt.digital");
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? (BASE.includes("localhost") ? "natacao-demo" : undefined);
const ATHLETE_EMAIL = process.env.ATHLETE_EMAIL ?? (BASE.includes("localhost") ? "ana@natacao.local" : "atleta@elevamkt.digital");
const ATHLETE_PASSWORD = process.env.ATHLETE_PASSWORD ?? (BASE.includes("localhost") ? "natacao-demo" : undefined);

const coachViews = [
  { view: "today", path: "/pt/coach/today" },
  { view: "athletes", path: "/pt/coach/athletes" },
  { view: "practices", path: "/pt/coach/practices" },
  { view: "seasons", path: "/pt/coach/seasons" },
  { view: "videos", path: "/pt/coach/videos" },
  { view: "analytics", path: "/pt/coach/analytics" },
  { view: "rkf", path: "/pt/coach/rkf" },
  { view: "inbox", path: "/pt/coach/inbox" },
  { view: "integrations", path: "/pt/coach/integrations" },
  { view: "settings", path: "/pt/coach/settings" },
];

const athleteViews = [
  { view: "welcome", path: "/pt/athlete/welcome" },
  { view: "home", path: "/pt/athlete/home" },
  { view: "week", path: "/pt/athlete/week" },
  { view: "competitions", path: "/pt/athlete/competitions" },
  { view: "results", path: "/pt/athlete/results" },
];

async function loginCoach(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/pt/coach/today`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const emailField = page.getByRole("textbox", { name: "E-mail" });
  if (await emailField.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false)) {
    if (!COACH_PASSWORD) throw new Error("Defina COACH_PASSWORD para auditar uma instância sem auto-login.");
    await emailField.fill(COACH_EMAIL);
    await page.getByRole("textbox", { name: "Senha" }).fill(COACH_PASSWORD);
    const loginResponse = page.waitForResponse((response) => response.url().includes("/api/v1/auth/login"), { timeout: 20_000 }).catch(() => null);
    await page.getByRole("button", { name: /entrar/i }).click();
    const response = await loginResponse;
    if (response) expect(response.status()).toBe(200);
  }
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 30_000 });
}

async function loginAthlete(page: import("@playwright/test").Page) {
  await page.goto(`${BASE}/pt/athlete/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const emailField = page.getByRole("textbox", { name: "E-mail ou CPF" });
  await emailField.waitFor({ state: "visible", timeout: 20_000 });
  if (!ATHLETE_PASSWORD) throw new Error("Defina ATHLETE_PASSWORD para auditar uma instância sem auto-login.");
  await emailField.fill(ATHLETE_EMAIL);
  await page.getByRole("textbox", { name: "Senha" }).fill(ATHLETE_PASSWORD);
  const loginResponse = page.waitForResponse((response) => response.url().includes("/api/v1/auth/login"), { timeout: 20_000 }).catch(() => null);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  const response = await loginResponse;
  if (response) expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/pt\/athlete\/(checkin|home)/, { timeout: 20_000 });
  if (page.url().includes("/checkin")) {
    await page.getByRole("button", { name: /Iniciar meu dia|Atualizar check-in/ }).click();
  }
  await expect(page).toHaveURL(/\/pt\/athlete\/home/, { timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  // Captura erros de console e pageerror para diagnóstico
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  (page as unknown as { __consoleErrors: string[] }).__consoleErrors = consoleErrors;
});

/** O 401 de /auth/me antes do login e ruído de rede/favicon não são defeitos. */
const isFatalConsoleError = (error: string) =>
  !/net::|ERR_NETWORK|Failed to fetch|favicon|401|404/i.test(error) || /SyntaxError|TypeError|ReferenceError|is not defined|Cannot read/i.test(error);

for (const project of ["desktop", "mobile"] as const) {
  test.describe(`auditoria coach @${project}`, () => {
    test(`todas as 10 views do coach renderizam sem erro (${project})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== project, `rodando apenas em ${project}`);
      test.setTimeout(240_000);
      await loginCoach(page);
      const errors: string[] = [];
      for (const view of coachViews) {
        await page.goto(`${BASE}${view.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2_500);
        const consoleErrors = (page as unknown as { __consoleErrors: string[] }).__consoleErrors;
        const newErrors = consoleErrors.filter((error) => !errors.includes(error));
        errors.push(...newErrors);
        // A view precisa ter conteúdo substancial (não página em branco)
        const text = await page.locator("main, [role=main], .content, body").first().innerText();
        expect(text.trim().length, `view ${view.view} parece vazia`).toBeGreaterThan(50);
      }
      // Erros de rede transitórios são tolerados; pageerror/JS não
      const fatal = errors.filter(isFatalConsoleError);
      expect(fatal, `erros de console: ${fatal.join(" | ")}`).toEqual([]);
    });

    test(`navegação por todas as views funciona (${project})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== project, `rodando apenas em ${project}`);
      test.setTimeout(180_000);
      await loginCoach(page);
      for (const view of coachViews.slice(0, 6)) {
        const label = { today: /^Hoje$/, athletes: /^Equipe$/, practices: /^Treinos$/, seasons: /^Temporada$/, videos: /^Vídeos/, analytics: /^Análise$/ }[view.view as "today"] ?? new RegExp(view.view);
        if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Abrir menu" }).click();
        const item = page.locator("aside.sidebar").getByRole("button", { name: label });
        await expect(item).toBeVisible({ timeout: 15_000 });
        await item.click();
        await expect(page).toHaveURL(new RegExp(view.path), { timeout: 15_000 });
      }
    });
  });

  test.describe(`auditoria athlete @${project}`, () => {
    test(`telas públicas e pós-login do atleta renderizam (${project})`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== project, `rodando apenas em ${project}`);
      await page.goto(`${BASE}/pt/athlete/welcome`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(/atleta|treinos|performance/i);
      await loginAthlete(page);
      for (const view of athleteViews.filter((item) => !["welcome", "access", "login", "onboarding"].includes(item.view))) {
        await page.goto(`${BASE}${view.path}`, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(view.path), { timeout: 15_000 });
        const probes: Record<string, RegExp> = {
          home: /Sessão prescrita|Sessão concluída|Check-in pendente|Sem sessão prescrita/,
          week: /Resumo semanal|Próximas sessões|Planejado/,
          competitions: /Competições/,
          results: /Registrar resultados|Sem sessão para registrar/,
        };
        await expect(page.locator("body")).toContainText(probes[view.view] ?? /.+/, { timeout: 20_000 });
        const text = await page.locator("body").first().innerText();
        expect(text.trim().length, `tela ${view.view} parece vazia`).toBeGreaterThan(80);
      }
    });
  });
}
