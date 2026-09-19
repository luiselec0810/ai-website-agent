import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — tests E2E del frontend Next.js del AI Website Agent.
 *
 * - Apunta al dev server que ya está corriendo en :3000 (`reuseExistingServer`)
 *   para no chocar con la sesión del usuario cuando trabaja en local.
 * - En CI (`process.env.CI === '1'`) levanta un servidor fresco con `npm run dev`.
 * - `headless: true` por defecto; correr con `--headed` si hay que depurar.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Solo levantar `npm run dev` si no hay servidor ya corriendo en :3000.
  // En este repo normalmente el dev server ya está activo (lo arranca el
  // usuario o el `make up`), así que `reuseExistingServer: true` evita
  // chocar contra otra instancia y ahorra ~30 s por corrida.
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
