import { test, expect } from "@playwright/test";

/**
 * Gate G24 — menu principal com estrutura verificável: navegação do coach
 * renderiza os itens essenciais e a navegação por clique funciona em
 * desktop e mobile.
 */
test("G24: navegação principal do coach contém os itens essenciais", async ({ page }) => {
  await page.goto("/pt/coach/today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 20_000 });
  for (const item of ["Hoje", "Equipe", "Treinos", "Análise"]) {
    await expect(page.locator(`nav :has-text("${item}")`).first()).toBeVisible();
  }
});

test("G24: clique em item de menu navega para a tela correspondente", async ({ page, isMobile }) => {
  await page.goto("/pt/coach/today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 20_000 });
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
  await page.goto("/pt/athlete/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  const body = await page.locator("body").innerText();
  const items = ["Hoje", "Semanal", "Fase", "Competições", "Mais"].filter((item) => body.includes(item));
  expect(items.length).toBeGreaterThanOrEqual(4);
});

test("G24: em mobile a navegação permanece utilizável", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pt/coach/today", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 20_000 });
  // Menu hamburger ou bottom-nav precisa existir e ser clicável
  const navToggle = page.locator("nav, [aria-label*='menu' i], button:has-text('Hoje')").first();
  await expect(navToggle).toBeVisible();
});
