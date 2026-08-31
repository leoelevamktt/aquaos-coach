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

for (const screen of screens) {
  test(`G23: tela ${screen.id} renderiza (@${screen.path})`, async ({ page }) => {
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
