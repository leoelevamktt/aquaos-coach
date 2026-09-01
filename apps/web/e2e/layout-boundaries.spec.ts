import { test, expect, type Page } from "@playwright/test";

const base = process.env.FRONTEND_URL ?? "http://localhost:3000";
const local = base.includes("localhost");
const coachEmail = process.env.COACH_EMAIL ?? (local ? "coach@natacao.local" : "treinador@elevamkt.digital");
const coachPassword = process.env.COACH_PASSWORD ?? (local ? "natacao-demo" : undefined);

async function loginCoach(page: Page) {
  await page.goto(`${base}/pt/coach/today`, { waitUntil: "domcontentloaded" });
  const email = page.getByRole("textbox", { name: "E-mail" });
  if (await email.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false)) {
    if (!coachPassword) throw new Error("COACH_PASSWORD é obrigatório fora do ambiente local.");
    await email.fill(coachEmail);
    await page.getByRole("textbox", { name: "Senha" }).fill(coachPassword);
    await page.getByRole("button", { name: /entrar/i }).click();
  }
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 30_000 });
}

async function assertBoundary(page: Page, width: number) {
  const result = await page.evaluate((viewportWidth) => {
    const intentionalScroll = ".week-grid, .rkf-tabs, .video-stats, .flow-diagram, .management-nav, .message-templates > div, .pool-frame";
    const hiddenByTransform = (element: Element) => {
      let current: Element | null = element;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        const rect = current.getBoundingClientRect();
        if (style.transform !== "none" && rect.right < 0) return true;
        current = current.parentElement;
      }
      return false;
    };
    const escaped = [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && !hiddenByTransform(element)
        && (rect.left < -1 || rect.right > viewportWidth + 1)
        && !element.closest(intentionalScroll);
    }).filter((element) => !["BODY", "HTML", "SVG", "PATH"].includes(element.tagName)).slice(0, 10).map((element) => ({ tag: element.tagName, className: String(element.className), text: (element.textContent ?? "").trim().slice(0, 70), rect: [Math.round(element.getBoundingClientRect().left), Math.round(element.getBoundingClientRect().right)] }));
    return { documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, escaped };
  }, width);
  expect(result.documentWidth, `documento excedeu ${width}px`).toBeLessThanOrEqual(width + 1);
  expect(result.bodyWidth, `body excedeu ${width}px`).toBeLessThanOrEqual(width + 1);
  expect(result.escaped, `elementos escaparam da viewport ${width}px`).toEqual([]);
}

test("limites 320/768 não quebram telas coach", async ({ page }) => {
  test.setTimeout(120_000);
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`); });
  await loginCoach(page);
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/pt/coach/today", "/pt/coach/athletes", "/pt/coach/practices", "/pt/coach/seasons", "/pt/coach/videos", "/pt/coach/analytics", "/pt/coach/rkf", "/pt/coach/inbox", "/pt/coach/integrations", "/pt/coach/settings"]) {
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
      await page.locator(".content").waitFor({ state: "visible", timeout: 20_000 });
      await assertBoundary(page, width);
    }
  }
  expect(failures).toEqual([]);
});
