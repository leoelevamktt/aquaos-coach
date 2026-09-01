import { test, expect } from "@playwright/test";

const base = process.env.FRONTEND_URL ?? "http://localhost:3000";
const local = base.includes("localhost");
const coachEmail = process.env.COACH_EMAIL ?? (local ? "coach@natacao.local" : "treinador@elevamkt.digital");
const coachPassword = process.env.COACH_PASSWORD ?? (local ? "natacao-demo" : undefined);
const athleteEmail = process.env.ATHLETE_EMAIL ?? (local ? "ana@natacao.local" : "atleta@elevamkt.digital");
const athletePassword = process.env.ATHLETE_PASSWORD ?? (local ? "natacao-demo" : undefined);

async function loginCoach(page: import("@playwright/test").Page) {
  await page.goto("/pt/coach/today", { waitUntil: "domcontentloaded" });
  const email = page.getByRole("textbox", { name: "E-mail" });
  if (await email.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false)) {
    if (!coachPassword) throw new Error("COACH_PASSWORD é obrigatório para testar telas protegidas.");
    await page.waitForLoadState("networkidle");
    await email.fill(coachEmail);
    await page.getByRole("textbox", { name: "Senha" }).fill(coachPassword);
    await page.getByRole("button", { name: /entrar/i }).click();
  }
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 30_000 });
}

async function loginAthlete(page: import("@playwright/test").Page) {
  await page.goto("/pt/athlete/login", { waitUntil: "domcontentloaded" });
  if (!athletePassword) throw new Error("ATHLETE_PASSWORD é obrigatório para testar telas protegidas.");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "E-mail ou CPF" }).fill(athleteEmail);
  await page.getByRole("textbox", { name: "Senha" }).fill(athletePassword);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await expect(page).toHaveURL(/\/pt\/athlete\/(checkin|home)/);
  if (page.url().includes("/checkin")) {
    await page.getByRole("button", { name: /Iniciar meu dia|Atualizar check-in/ }).click();
  }
  await expect(page).toHaveURL(/\/pt\/athlete\/home/);
}

/**
 * Gate G24 — menu principal com estrutura verificável: navegação do coach
 * renderiza os itens essenciais e a navegação por clique funciona em
 * desktop e mobile.
 */
test("G24: navegação principal do coach contém os itens essenciais", async ({ page }) => {
  await loginCoach(page);
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 20_000 });
  for (const item of ["Hoje", "Equipe", "Treinos", "Análise"]) {
    await expect(page.locator(`nav :has-text("${item}")`).first()).toBeVisible();
  }
});

test("G24: clique em item de menu navega para a tela correspondente", async ({ page, isMobile }) => {
  await loginCoach(page);
  if (isMobile) {
    // Em mobile a sidebar fica escondida: abre pelo botão "Abrir menu"
    await page.locator('button[aria-label="Abrir menu"]').first().click();
    const equipe = page.locator("button", { hasText: "Equipe" }).first();
    await expect(equipe).toBeVisible({ timeout: 15_000 });
    await equipe.click();
  } else {
    await page.locator('nav button:has-text("Equipe")').first().click();
  }
  await expect(page).toHaveURL(/\/pt\/coach\/athletes/, { timeout: 15_000 });
  await expect(page.locator("body")).toContainText(/atleta|equipe|plantel/i, { timeout: 15_000 });
});

test("G24: menu inferior do atleta tem os itens de navegação", async ({ page }) => {
  await loginAthlete(page);
  await expect(page.getByRole("navigation")).toBeVisible();
  const body = await page.locator("body").innerText();
  const items = ["Hoje", "Semanal", "Fase", "Competições", "Mais"].filter((item) => body.includes(item));
  expect(items.length).toBeGreaterThanOrEqual(4);
});

test("G24: em mobile a navegação permanece utilizável", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginCoach(page);
  // Menu hamburger ou bottom-nav precisa existir e ser clicável
  const navToggle = page.locator("nav, [aria-label*='menu' i], button:has-text('Hoje')").first();
  await expect(navToggle).toBeVisible();
});
