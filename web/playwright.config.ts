import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './e2e/support/env';

/**
 * End-to-end tests against the environment in e2e/docker-compose.yml (see web/README.md).
 * `npm run e2e` assumes it is up; `npm run e2e:ci` brings it up, runs and tears it down.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: the flows share Keycloak users and build on each other's server state.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: WEB_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The issuer is http://keycloak:18180 for the backend containers (Docker DNS) and for the
    // browser alike; the browser resolves that name to the port published on localhost.
    launchOptions: { args: ['--host-resolver-rules=MAP keycloak 127.0.0.1'] },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'desktop',
      testMatch: /\.spec\.ts$/,
      testIgnore: /mobile\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'] },
    },
  ],
});
