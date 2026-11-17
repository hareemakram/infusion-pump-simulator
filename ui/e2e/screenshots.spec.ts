import { expect, test } from '@playwright/test';

// Generates the README images: `SCREENSHOTS=1 npx playwright test screenshots --project=desktop`
test.skip(!process.env.SCREENSHOTS, 'screenshots only on request');
test.use({ deviceScaleFactor: 2 });

test('README screenshots', async ({ page }) => {
  const out = '../docs/img';
  await page.request.post('/api/sim', { data: { action: 'restart', speed: 20 } });
  await page.goto('/');
  await page.locator('[data-action=program]').click();
  await page.getByRole('button', { name: /Heparin/ }).click();
  for (const d of '22') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByTestId('field-vtbi').click();
  for (const d of '250') await page.getByRole('button', { name: d, exact: true }).click();
  await page.locator('.device').screenshot({ path: `${out}/program.png` });
  await page.locator('.sheet__foot').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('override').check({ force: true });
  await page.getByTestId('confirm-program').click();
  await page.locator('[data-action=prime]').click();
  await expect(page.locator('[data-action=start]')).toBeEnabled({ timeout: 15_000 });
  await page.locator('[data-action=start]').click();
  await page.locator('.device').screenshot({ path: `${out}/confirm.png` });
  await page.getByTestId('confirm-start').click();
  await page.waitForTimeout(3000);
  await page.request.post('/api/sim', { data: { speed: 1 } });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/overview.png` });
  await page.request.post('/api/sim', { data: { speed: 10 } });
  await page.getByRole('switch', { name: 'Downstream occlusion' }).click();
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('data-priority', 'HIGH', { timeout: 20_000 });
  await page.request.post('/api/sim', { data: { speed: 1 } });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/alarm.png` });
});
