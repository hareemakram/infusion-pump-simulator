import { expect, test, type Page } from '@playwright/test';

async function resetSim(page: Page, speed = 1) {
  await page.request.post('/api/sim', { data: { action: 'restart', speed } });
  await page.goto('/');
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'IDLE');
}

async function setSpeed(page: Page, speed: number) {
  await page.request.post('/api/sim', { data: { speed } });
}

async function keys(page: Page, digits: string) {
  for (const d of digits) {
    await page.getByRole('button', { name: d === '.' ? 'Decimal point' : d, exact: true }).click();
  }
}

/** Programs a drug through the touch wizard. */
async function program(page: Page, drug: RegExp, rate: string, vtbi: string, opts: { override?: boolean } = {}) {
  await page.locator('[data-action=program], [data-action=edit]').first().click();
  await page.getByRole('button', { name: drug }).click();
  await page.getByTestId('field-rate').click();
  await keys(page, rate);
  await page.getByTestId('field-vtbi').click();
  await keys(page, vtbi);
  await page.locator('.sheet__foot').getByRole('button', { name: 'Review' }).click();
  if (opts.override) await page.getByTestId('override').check({ force: true });
  await page.getByTestId('confirm-program').click();
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'READY');
}

async function primeAndStart(page: Page) {
  await setSpeed(page, 20);
  await page.locator('[data-action=prime]').click();
  await expect(page.locator('[data-action=start]')).toBeEnabled({ timeout: 15_000 });
  await setSpeed(page, 1);
  await page.locator('[data-action=start]').click();
  await expect(page.getByRole('dialog', { name: 'Start infusion?' })).toBeVisible();
  await page.getByTestId('confirm-start').click();
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'INFUSING');
}

test.describe('infusion workflow @touch', () => {
  test('program, prime, confirm and start an infusion (SRS-010, SRS-080, SRS-083)', async ({ page }) => {
    await resetSim(page);
    await program(page, /Heparin/, '10', '250');
    // Start is blocked until the line is primed (SRS-010).
    await expect(page.locator('[data-action=start]')).toBeDisabled();
    await expect(page.getByText('Prime the line first')).toBeVisible();
    await primeAndStart(page);
    await expect(page.getByTestId('rate-display')).toContainText('10.0');
    await expect(page.getByTestId('rate-display')).toContainText('1,000');
    await expect(page.getByTestId('rate-display')).toContainText('Delivering');
    await expect(page.locator('.log')).toContainText('READY -> INFUSING');
  });
});

test('cancelling the start confirmation does not start delivery (SRS-080)', async ({ page }) => {
  await resetSim(page);
  await program(page, /Sodium chloride/, '100', '50');
  await setSpeed(page, 20);
  await page.locator('[data-action=prime]').click();
  await expect(page.locator('[data-action=start]')).toBeEnabled({ timeout: 15_000 });
  await page.locator('[data-action=start]').click();
  await page.locator('.sheet__foot').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'READY');
});

test('hard dose limit cannot be passed, soft limit needs an override (SRS-003, SRS-004)', async ({ page }) => {
  await resetSim(page);
  await page.locator('[data-action=program]').click();
  await page.getByRole('button', { name: /Heparin/ }).click();
  await keys(page, '35');
  await page.getByTestId('field-vtbi').click();
  await keys(page, '100');
  await expect(page.getByTestId('dose-verdict')).toContainText('above the hard limit');
  await expect(page.locator('.sheet__foot').getByRole('button', { name: 'Review' })).toBeDisabled();
  await page.getByTestId('field-rate').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await keys(page, '25');
  await expect(page.getByTestId('dose-verdict')).toContainText('above the usual maximum');
  await page.locator('.sheet__foot').getByRole('button', { name: 'Review' }).click();
  await expect(page.getByTestId('confirm-program')).toBeDisabled();
  await page.getByTestId('override').check({ force: true });
  await page.getByTestId('confirm-program').click();
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'READY');
  await expect(page.locator('.log')).toContainText('operator confirmed');
});

test('occlusion raises a high-priority alarm that needs acknowledging (SRS-013, SRS-043, SRS-081)', async ({ page }) => {
  await resetSim(page);
  await program(page, /Sodium chloride/, '200', '500');
  await primeAndStart(page);
  await setSpeed(page, 10);
  await page.getByRole('switch', { name: 'Downstream occlusion' }).click();

  const banner = page.getByTestId('alarm-banner');
  await expect(banner).toHaveAttribute('data-priority', 'HIGH', { timeout: 20_000 });
  await expect(page.getByTestId('alarm-title')).toHaveText('Occlusion: patient side');
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'ALARM');
  await expect(page.getByTestId('rate-display')).toContainText('Not delivering');
  await expect(page.getByTestId('lightbar')).toHaveClass(/lightbar--high/);
  await setSpeed(page, 1);

  // Cannot acknowledge while the line is still blocked (SRS-043).
  await expect(banner.getByRole('button', { name: /Acknowledge/ })).toBeDisabled();
  await banner.getByRole('button', { name: /Silence/ }).click();
  await expect(banner).toContainText('2:00');

  await page.getByRole('switch', { name: 'Downstream occlusion' }).click();
  await expect(banner.getByRole('button', { name: /Acknowledge/ })).toBeEnabled({ timeout: 10_000 });
  await banner.getByRole('button', { name: /Acknowledge/ }).click();
  // No automatic restart (SRS-013): the pump waits, paused.
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'PAUSED');
  await expect(page.getByTestId('alarm-banner')).toHaveCount(0);
});

test('alarm priorities are distinct: low, medium and high (SRS-040, SRS-081)', async ({ page }) => {
  await resetSim(page);
  await program(page, /Sodium chloride/, '480', '5');
  await primeAndStart(page);
  await setSpeed(page, 20);
  // VTBI of 5 mL at 480 mL/h completes after ~38 s: medium priority.
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('data-priority', 'MEDIUM', { timeout: 20_000 });
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'KVO');
  await page.getByTestId('alarm-banner').getByRole('button', { name: /Acknowledge/ }).click();
  await expect(page.getByTestId('alarm-banner')).toHaveCount(0);
  // Pausing for over two minutes gives a low priority reminder.
  await page.locator('[data-action=pause]').click();
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('data-priority', 'LOW', { timeout: 20_000 });
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('role', 'status');
  // An air bubble only matters while delivering; resume, then inject.
  await setSpeed(page, 1);
  await page.locator('[data-action=resume]').click();
  await page.getByTestId('confirm-start').click();
  await page.locator('[data-fault=air_bubble]').click();
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('data-priority', 'HIGH');
  await expect(page.getByTestId('alarm-banner')).toHaveAttribute('role', 'alert');
});

test('sensor fault forces a restart (SRS-053)', async ({ page }) => {
  await resetSim(page);
  await program(page, /Sodium chloride/, '100', '100');
  await primeAndStart(page);
  await page.getByRole('switch', { name: 'Pressure sensor at rail' }).click();
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'FAULT');
  await expect(page.getByText(/Pump stopped: sensor failure/)).toBeVisible();
  await page.getByRole('switch', { name: 'Pressure sensor at rail' }).click();
  await page.locator('[data-action=restart]').click();
  await expect(page.getByTestId('state-chip')).toHaveAttribute('data-state', 'IDLE');
});

test('sensor link dropout stops the pump with a restart-required alarm (SRS-052)', async ({ page }) => {
  await resetSim(page);
  await program(page, /Sodium chloride/, '100', '100');
  await primeAndStart(page);
  await page.getByRole('switch', { name: 'Sensor link dropout' }).click();
  await expect(page.getByTestId('alarm-title')).toHaveText('Sensors not responding');
  await page.getByRole('switch', { name: 'Sensor link dropout' }).click();
});
