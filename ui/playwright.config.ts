import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8123);
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

/**
 * End-to-end tests run the real stack: the built React app served by the
 * Python service, which drives the compiled C++ firmware.
 * Prerequisites: `cmake --build build` (firmware) and `npm run build` (UI).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one simulated pump is shared by all tests
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: '../reports/playwright-junit.xml' }], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true }, grep: /@touch/ },
  ],
  webServer: {
    command: `${python} -m pumpsim serve --port ${PORT}`,
    cwd: '..',
    env: { PYTHONPATH: 'simulator' },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
