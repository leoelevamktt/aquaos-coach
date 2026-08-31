import { defineConfig } from "@playwright/test";

/**
 * E2E do frontend RKF Coach (gates G23/G24/G27/G28).
 * Executa contra o dev server Next (porta 3000) com a API local (porta 4000).
 * Em CI/produção, aponte FRONTEND_URL para o host alvo.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.FRONTEND_URL ?? "http://localhost:3000",
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.FRONTEND_URL
    ? undefined
    : {
        command: "npm run dev -w @natacao/web",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
