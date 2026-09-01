import { expect, test, type Page } from "@playwright/test";

const local = (process.env.FRONTEND_URL ?? "http://localhost:3000").includes("localhost");
const coachEmail = process.env.COACH_EMAIL ?? (local ? "coach@natacao.local" : "treinador@elevamkt.digital");
const coachPassword = process.env.COACH_PASSWORD ?? (local ? "natacao-demo" : undefined);

async function loginCoach(page: Page) {
  await page.goto("/pt/coach/today", { waitUntil: "domcontentloaded" });
  const email = page.getByRole("textbox", { name: "E-mail" });
  if (await email.isVisible().catch(() => false)) {
    if (!coachPassword) throw new Error("COACH_PASSWORD é obrigatório fora do ambiente local.");
    await email.fill(coachEmail);
    await page.getByRole("textbox", { name: "Senha" }).fill(coachPassword);
    await page.getByRole("button", { name: /entrar/i }).click();
  }
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 30_000 });
}

test("a interface coach preserva escala, hierarquia e piso de leitura", async ({ page }) => {
  await loginCoach(page);
  const floor = 11;
  for (const route of ["today", "analytics", "inbox", "integrations"]) {
    await page.goto(`/pt/coach/${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(".content").waitFor({ state: "visible" });
    const audit = await page.evaluate((minimum) => {
      const elements = [...document.querySelectorAll<HTMLElement>(".content *")].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const ownsText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
        return ownsText && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const undersized = elements.filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < minimum)
        .map((element) => ({ className: element.className, size: getComputedStyle(element).fontSize, text: element.textContent?.trim().slice(0, 60) }));
      const pageTitle = document.querySelector<HTMLElement>(".page-title h1");
      const sectionTitle = document.querySelector<HTMLElement>(".section-head h2");
      return {
        undersized,
        pageTitle: pageTitle ? Number.parseFloat(getComputedStyle(pageTitle).fontSize) : 0,
        sectionTitle: sectionTitle ? Number.parseFloat(getComputedStyle(sectionTitle).fontSize) : 0,
      };
    }, floor);

    expect(audit.undersized, `${route} contém texto abaixo de ${floor}px`).toEqual([]);
    expect(audit.pageTitle).toBeGreaterThan(floor);
    if (audit.sectionTitle > 0) {
      expect(audit.pageTitle).toBeGreaterThan(audit.sectionTitle);
      expect(audit.sectionTitle).toBeGreaterThan(floor);
    }
  }
});
