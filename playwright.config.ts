import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    /**
     * Every spec starts already knowing who it is (M13).
     *
     * The app asks 누구세요? on first open and renders nothing else until it is
     * answered, which would put a wall in front of all 65 specs that came
     * before it. Seeding the profile here — rather than clicking the picker in
     * 65 `beforeEach`es — keeps those specs about what they are about.
     *
     * The value is exactly what `profile.saveProfile` writes: a JSON string,
     * quotes and all. `e2e/profile.spec.ts` opts back out with an empty
     * `storageState` to get at the first-run experience itself.
     */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [{ name: 'trip-board/profile', value: '"song"' }],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
