import { defineConfig } from "@playwright/test";

const e2eApiPort = Number(process.env.E2E_API_PORT ?? 4100);
const e2eWebPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const configuredFrontendUrl = process.env.FRONTEND_URL;
const localFrontendUrl = `http://localhost:${e2eWebPort}`;
const frontendUrl = configuredFrontendUrl ?? localFrontendUrl;
process.env.FRONTEND_URL = frontendUrl;

/**
 * E2E do frontend RKF Coach (gates G23/G24/G27/G28).
 * Executa contra o dev server Next (porta 3100) com a API local (porta 4100).
 * Em CI/produção, aponte FRONTEND_URL para o host alvo.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: frontendUrl,
    viewport: { width: 1280, height: 800 },
    locale: "pt-BR",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: configuredFrontendUrl
    ? undefined
    : [
        {
          command: "npm run dev -w @natacao/api",
          url: `http://localhost:${e2eApiPort}/api/v1/health`,
          env: {
            ...process.env,
            API_PORT: String(e2eApiPort),
            CORS_ORIGINS: localFrontendUrl,
            APP_BASE_URL: localFrontendUrl,
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: `npm run dev -w @natacao/web -- -p ${e2eWebPort}`,
          url: `${localFrontendUrl}/pt/coach/today`,
          env: { ...process.env, NEXT_PUBLIC_API_URL: `http://localhost:${e2eApiPort}` },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
