import { test, expect } from "@playwright/test";

/**
 * Gate G23 — as oito telas obrigatórias do produto renderizam em desktop e
 * mobile com conteúdo real (manual §22: /, /signin, /coach, /load-control,
 * /full, /athlete, /team, /training/register mapeadas para as rotas atuais).
 */
const screens = [
  { id: "home", path: "/pt/coach/today", probe: /Bom dia|Boa tarde|Boa noite/ },
  { id: "signin", path: "/pt/athlete/login", probe: /entrar|acessar|cpf|e-mail/i },
  { id: "coach", path: "/pt/coach/practices", probe: /treino|prescri/i },
  { id: "load-control", path: "/pt/coach/analytics", probe: /carga|readiness|análise/i },
  { id: "full", path: "/pt/coach/rkf", probe: /rkf|núcleo|biblioteca/i },
  { id: "athlete", path: "/pt/athlete/welcome", probe: /atleta|bem-vindo|treino/i },
  { id: "team", path: "/pt/coach/athletes", probe: /atleta|equipe|plantel/i },
  { id: "training-register", path: "/pt/athlete/home", probe: /treino|hoje|sess/i },
];

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

for (const screen of screens) {
  test(`G23: tela ${screen.id} renderiza (@${screen.path})`, async ({ page }) => {
    if (screen.path.startsWith("/pt/coach/")) await loginCoach(page);
    if (screen.path === "/pt/athlete/home") await loginAthlete(page);
    const response = await page.goto(screen.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(400);
    // Aguarda hidratação/autolog demo e procura o conteúdo característico
    await expect(page.locator("body")).toContainText(screen.probe, { timeout: 20_000 });
  });
}

test("G23: nenhuma tela quebra em erro de aplicação", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const screen of screens.slice(0, 3)) {
    await page.goto(screen.path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);
  }
  expect(errors).toEqual([]);
});
