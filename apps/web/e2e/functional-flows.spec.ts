import { test, expect, type Page } from "@playwright/test";

const LOCAL = (process.env.FRONTEND_URL ?? "http://localhost:3000").includes("localhost");
const BASE = process.env.FRONTEND_URL ?? "http://localhost:3000";
const COACH_EMAIL = process.env.COACH_EMAIL ?? (LOCAL ? "coach@natacao.local" : "treinador@elevamkt.digital");
const COACH_PASSWORD = process.env.COACH_PASSWORD ?? (LOCAL ? "natacao-demo" : undefined);
const ATHLETE_EMAIL = process.env.ATHLETE_EMAIL ?? (LOCAL ? "ana@natacao.local" : "atleta@elevamkt.digital");
const ATHLETE_PASSWORD = process.env.ATHLETE_PASSWORD ?? (LOCAL ? "natacao-demo" : undefined);

async function assertLayout(page: Page) {
  const result = await page.evaluate(() => {
    const width = window.innerWidth;
    const viewportOverflow = { document: document.documentElement.scrollWidth, body: document.body.scrollWidth };
    const modalOverflow = [...document.querySelectorAll<HTMLElement>("[role=dialog]")].map((modal) => {
      const rect = modal.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: modal.scrollWidth, clientWidth: modal.clientWidth };
    });
    return { width, viewportOverflow, modalOverflow };
  });
  expect(result.viewportOverflow.document, "documento com overflow horizontal").toBeLessThanOrEqual(result.width + 1);
  expect(result.viewportOverflow.body, "body com overflow horizontal").toBeLessThanOrEqual(result.width + 1);
  for (const modal of result.modalOverflow) {
    expect(modal.left, "modal saiu pela esquerda").toBeGreaterThanOrEqual(-1);
    expect(modal.right, "modal saiu pela direita").toBeLessThanOrEqual(result.width + 1);
    expect(modal.scrollWidth, "conteúdo do modal estourou horizontalmente").toBeLessThanOrEqual(modal.clientWidth + 1);
  }
}

async function loginCoach(page: Page) {
  await page.goto(`${BASE}/pt/coach/today`, { waitUntil: "networkidle" });
  const email = page.getByRole("textbox", { name: "E-mail" });
  if (await email.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false)) {
    if (!COACH_PASSWORD) throw new Error("COACH_PASSWORD é obrigatório fora do ambiente local.");
    await email.fill(COACH_EMAIL);
    await page.getByRole("textbox", { name: "Senha" }).fill(COACH_PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
  }
  await expect(page.locator("body")).toContainText(/Bom dia|Boa tarde|Boa noite/, { timeout: 30_000 });
}

async function loginAthlete(page: Page) {
  await page.goto(`${BASE}/pt/athlete/login`, { waitUntil: "networkidle" });
  if (!ATHLETE_PASSWORD) throw new Error("ATHLETE_PASSWORD é obrigatório fora do ambiente local.");
  await page.getByRole("textbox", { name: "E-mail ou CPF" }).fill(ATHLETE_EMAIL);
  await page.getByRole("textbox", { name: "Senha" }).fill(ATHLETE_PASSWORD);
  await page.getByRole("button", { name: /^Entrar$/ }).click();
  await expect(page).toHaveURL(/\/pt\/athlete\/checkin/);
  await page.getByRole("button", { name: "Iniciar meu dia" }).click();
  await expect(page).toHaveURL(/\/pt\/athlete\/home/);
}

test.describe("fluxos do coach", () => {
  test("card de meta não sobrepõe evolução e alvo", async ({ page }) => {
    await loginCoach(page);
    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/pt/coach/athletes/ana-souza`, { waitUntil: "networkidle" });
      const route = page.locator(".goal-route");
      await expect(route).toBeVisible();
      const geometry = await route.evaluate((element) => {
        const label = element.querySelector<HTMLElement>(".route-line span")?.getBoundingClientRect();
        const target = element.querySelector<HTMLElement>(".time-node.target")?.getBoundingClientRect();
        return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, labelRight: label?.right ?? 0, targetLeft: target?.left ?? 0 };
      });
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.labelRight).toBeLessThanOrEqual(geometry.targetLeft);
    }
  });

  test("logout do treinador encerra a sessão e permite trocar de perfil", async ({ page, isMobile }) => {
    await loginCoach(page);
    if (isMobile) await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("button", { name: "Sair / trocar perfil" }).click();
    await expect(page.getByRole("textbox", { name: "E-mail" })).toBeVisible({ timeout: 20_000 });
  });

  test("cria e publica treino pelo fluxo completo", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    await loginCoach(page);
    await assertLayout(page);
    await page.getByRole("button", { name: /^Criar$/ }).click();
    await expect(page.getByRole("dialog", { name: "Criar" })).toBeVisible();
    await page.getByRole("dialog", { name: "Criar" }).getByRole("button", { name: /^Treino/ }).click();
    await expect(page.getByRole("dialog", { name: "Criar treino na agenda" })).toBeVisible();
    await assertLayout(page);
    await page.getByRole("button", { name: "Estruturar treino" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("button", { name: /Publicar em/ }).click();
    await expect(page).toHaveURL(/\/pt\/coach\/practices/);
    await expect(page.locator("body")).toContainText(/Treinos|publicado/i);
    // O AuthGate consulta /auth/me antes do login; esse 401 esperado não é falha do fluxo.
    failures.splice(0, failures.length, ...failures.filter((failure) => !failure.includes("/api/v1/auth/me")));
    expect(failures).toEqual([]);
  });

  test("abre e fecha modais de equipe, temporada, vídeo e integrações", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 500) failures.push(`${response.status()} ${response.url()}`); });
    await loginCoach(page);

    await page.goto(`${BASE}/pt/coach/athletes`, { waitUntil: "networkidle" });
    await page.locator('.athlete-row[data-athlete-id="ana-souza"]').click();
    await expect(page).toHaveURL(/\/pt\/coach\/athletes\/ana-souza/);
    await expect(page.locator("body")).toContainText("Caminho até o objetivo");
    await page.getByRole("button", { name: "Mensagem" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertLayout(page);
    await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();

    await page.goto(`${BASE}/pt/coach/seasons`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Troféu|Campeonato|Open Internacional/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const tab of ["Equipe", "Programação", "Índices", "Provas"]) {
      await page.getByRole("dialog").getByRole("button", { name: tab, exact: true }).click();
      await assertLayout(page);
    }
    await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();

    await page.goto(`${BASE}/pt/coach/videos`, { waitUntil: "networkidle" });
    const video = page.locator(".video-thumb").first();
    await expect(video).toBeVisible({ timeout: 20_000 });
    await video.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await assertLayout(page);
    await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();

    await page.goto(`${BASE}/pt/coach/integrations`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Nova conexão/ }).click();
    await expect(page.getByRole("dialog", { name: "Conectar dispositivo" })).toBeVisible();
    await assertLayout(page);
    await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).last().click();
    expect(failures).toEqual([]);
  });

  test("navega pelos seis módulos RKF sem overflow", async ({ page }) => {
    await loginCoach(page);
    await page.goto(`${BASE}/pt/coach/rkf`, { waitUntil: "networkidle" });
    for (const tab of ["Comando", "Controle de carga", "Prescritor", "Ingestão", "Cobertura", "Governança"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
      await assertLayout(page);
    }
  });

  test("configurações e gestão abrem todos os estados navegáveis", async ({ page }) => {
    await loginCoach(page);
    await page.goto(`${BASE}/pt/coach/settings`, { waitUntil: "networkidle" });
    for (const tab of ["Programa", "Comissão técnica", "Zonas de intensidade", "Identidade", "Notificações", "Privacidade e LGPD", "Conta"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await expect(page.locator(".settings-panel")).toContainText(tab === "Zonas de intensidade" ? "Zonas de intensidade" : tab === "Privacidade e LGPD" ? "Privacidade e LGPD" : tab === "Comissão técnica" ? "Comissão técnica" : /.+/);
      await assertLayout(page);
    }
    await page.goto(`${BASE}/pt/coach/today`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Gerenciar" }).click();
    await expect(page.getByRole("dialog", { name: "Central de gestão" })).toBeVisible();
    await assertLayout(page);
    await page.getByRole("button", { name: "Fechar" }).click();
  });

  test("convite cria link de uso único e aceita primeiro acesso", async ({ page }) => {
    await loginCoach(page);
    await page.goto(`${BASE}/pt/coach/athletes`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Convidar atleta" }).click();
    const dialog = page.getByRole("dialog", { name: "Convidar atleta" });
    const email = `convite-${Date.now()}@example.test`;
    await dialog.getByRole("textbox", { name: "Nome completo" }).fill("Atleta Convidado");
    await dialog.getByRole("textbox", { name: "E-mail" }).fill(email);
    await dialog.getByRole("button", { name: "Criar convite" }).click();
    await expect(dialog).toContainText("Convite criado");
    const invitationUrl = await dialog.getByRole("textbox", { name: "Link do convite" }).inputValue();
    expect(invitationUrl).toContain("/pt/athlete/access?invite=");
    await dialog.getByRole("button", { name: "Concluir" }).click();
    await page.goto(invitationUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Primeiro acesso" }).click();
    await page.getByRole("textbox", { name: "E-mail de acesso (convite)" }).fill(email);
    await page.getByRole("textbox", { name: "Senha de acesso (convite)" }).fill("Convite-2026!");
    for (let step = 1; step < 6; step += 1) {
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page).toHaveURL(new RegExp(`/pt/athlete/onboarding/${step + 1}`));
    }
    await page.getByRole("button", { name: "Criar meu planejamento" }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/checkin/);
  });
});

test.describe("fluxos do atleta", () => {
  test("check-in, sessão, resultados, checkout e navegação inferior", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    await loginAthlete(page);
    failures.splice(0, failures.length, ...failures.filter((failure) => !failure.includes("/api/v1/auth/me")));
    await assertLayout(page);
    await page.getByRole("button", { name: /Sessão de hoje/ }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/session/);
    await assertLayout(page);
    await page.getByRole("button", { name: "Registrar resultados" }).click();
    await page.getByRole("button", { name: "Salvar resultados" }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/home/);
    await page.getByRole("button", { name: /Sessão de hoje/ }).click();
    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await page.getByRole("button", { name: "Finalizar meu dia" }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/home/);
    await page.getByRole("button", { name: "Competições", exact: true }).last().click();
    await page.getByRole("button", { name: "Inserir resultados", exact: true }).first().click();
    await expect(page.locator(".athlete-form")).toContainText("Resultado da competição");
    await page.getByRole("textbox", { name: "Tempo" }).fill("3:50.80");
    await page.getByRole("button", { name: "Salvar resultado" }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/competitions/);
    for (const item of ["Semanal", "Fase", "Competições", "Mais", "Hoje"]) {
      await page.getByRole("button", { name: item, exact: true }).last().click();
      await assertLayout(page);
    }
    expect(failures).toEqual([]);
    await page.getByRole("button", { name: "Mais", exact: true }).last().click();
    await page.getByRole("button", { name: "Sair da conta", exact: true }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/login/);
  });

  test("primeiro acesso coleta perfil, exige login e salva planejamento", async ({ page }) => {
    await page.goto(`${BASE}/pt/athlete/welcome`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Entrar no app" }).click();
    await page.getByRole("button", { name: /Primeiro acesso/ }).click();
    for (let step = 1; step < 6; step += 1) {
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page).toHaveURL(new RegExp(`/pt/athlete/onboarding/${step + 1}`));
    }
    await expect(page).toHaveURL(/\/pt\/athlete\/onboarding\/6/);
    await page.getByRole("button", { name: "Criar meu planejamento" }).click();
    await expect(page).toHaveURL(/\/pt\/athlete\/login/);
    await loginAthlete(page);
    await expect(page).toHaveURL(/\/pt\/athlete\/home/);
  });
});
