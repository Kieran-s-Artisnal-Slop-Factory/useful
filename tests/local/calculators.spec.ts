/**
 * Phase 3 (Calculators) — number conversion, photography, file transfer.
 * All three are stateless: the core assertion on every page is that computing
 * writes NOTHING. The one deliberate write (remembering the sensor format) is
 * audited as an isolated preferences delta.
 */
import { test, expect } from './helpers/app';
import { assertIsolatedDelta } from './helpers/oracle';

test.describe('number conversion', () => {
  test('converts between bases and runs bit operations with zero DB writes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    // Default value 5 at 8 bits, every base in sync.
    await expect(page.getByTestId('nb-input-2')).toHaveValue('00000101');
    await expect(page.getByTestId('nb-input-8')).toHaveValue('005');
    await expect(page.getByTestId('nb-input-16')).toHaveValue('05');

    // Editing hex rewrites the other three.
    await page.getByTestId('nb-input-16').fill('ff');
    await expect(page.getByTestId('nb-input-10')).toHaveValue('255');
    await expect(page.getByTestId('nb-input-2')).toHaveValue('11111111');
    await expect(page.getByTestId('nb-signed')).toHaveText('signed: -1');

    // Bit operations against the hand-computed 8-bit table for 5.
    await page.getByTestId('nb-input-10').fill('5');
    await expect(page.getByTestId('nb-op-not-bin')).toHaveText('1111 1010');
    await expect(page.getByTestId('nb-op-not-dec')).toHaveText('250');
    await expect(page.getByTestId('nb-op-ones-hex')).toHaveText('fa');
    await expect(page.getByTestId('nb-op-twos-bin')).toHaveText('1111 1011');
    await expect(page.getByTestId('nb-op-twos-dec')).toHaveText('251');

    // Width governs padding and the operations.
    await page.getByTestId('nb-width').selectOption('16');
    await expect(page.getByTestId('nb-input-2')).toHaveValue('0000000000000101');
    await expect(page.getByTestId('nb-op-twos-hex')).toHaveText('fffb');

    // A wrong-base digit errors that field and leaves the value alone.
    await page.getByTestId('nb-input-2').fill('102');
    await expect(page.getByTestId('nb-error-2')).toBeVisible();
    await expect(page.getByTestId('nb-input-10')).toHaveValue('5');

    // A negative decimal encodes as two's complement.
    await page.getByTestId('nb-input-10').fill('-5');
    await expect(page.getByTestId('nb-input-16')).toHaveValue('fffb');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('operation visualizer', () => {
  /**
   * Operand a is the page's own value; operand b is the second synchronised
   * set of base fields. Everything here is stateless, so every case ends by
   * asserting the database is byte-identical to what it was.
   */
  test('steps a trace and tells carry from signed overflow, writing nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    // Defaults: 5 + 3 at 8 bits, echoed in all four bases.
    await expect(page.getByTestId('nb-vis-expression')).toContainText('0x05 + 0x03 = 0x08');
    await expect(page.getByTestId('nb-vis-bin')).toHaveText('0000 1000');
    await expect(page.getByTestId('nb-vis-hex')).toHaveText('08');
    await expect(page.getByTestId('nb-vis-dec')).toHaveText('8');
    await expect(page.getByTestId('nb-vis-signed')).toHaveText('8');

    // The step table draws the columns that have been decided and no more.
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 1 of 8');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText(
      'Bit 0: 1 + 1 + carry 0 = 2'
    );
    await expect(page.getByTestId('nb-vis-step-back')).toBeDisabled();

    // Stepping forward moves through the columns and re-enables Back.
    await page.getByTestId('nb-vis-step-next').click();
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 2 of 8');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Bit 1: 0 + 1 + carry 1');
    await expect(page.getByTestId('nb-vis-step-back')).toBeEnabled();
    await expect(page.getByTestId('nb-vis-cell-now').first()).toBeVisible();
    await page.getByTestId('nb-vis-step-back').click();
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 1 of 8');

    // The stepper is operable from the keyboard, not the mouse alone.
    await page.getByTestId('nb-vis-step-next').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 2 of 8');

    // 0xFF + 1 CARRIES but does not overflow: -1 + 1 = 0 is fine signed.
    await page.getByTestId('nb-input-16').fill('ff');
    await page.getByTestId('nb-b-input-16').fill('01');
    await expect(page.getByTestId('nb-vis-dec')).toHaveText('0');
    await expect(page.getByTestId('nb-vis-flag-carry')).toContainText('Carry out: yes');
    await expect(page.getByTestId('nb-vis-flag-overflow')).toContainText('Signed overflow: no');
    // Editing an operand restarts the trace rather than leaving a stale step.
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 1 of 8');

    // 0x7F + 1 OVERFLOWS but does not carry: 127 + 1 cannot be +128 signed.
    await page.getByTestId('nb-input-16').fill('7f');
    await expect(page.getByTestId('nb-vis-dec')).toHaveText('128');
    await expect(page.getByTestId('nb-vis-signed')).toHaveText('-128');
    await expect(page.getByTestId('nb-vis-flag-carry')).toContainText('Carry out: no');
    await expect(page.getByTestId('nb-vis-flag-overflow')).toContainText('Signed overflow: yes');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('refuses division by zero in words and draws no table', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    await page.getByTestId('nb-op-picker').selectOption('divide');
    await page.getByTestId('nb-b-input-10').fill('0');

    await expect(page.getByTestId('nb-vis-error')).toContainText('Divide by zero');
    await expect(page.getByTestId('nb-vis-error')).not.toContainText('Infinity');
    await expect(page.getByTestId('nb-vis-table')).toHaveCount(0);
    await expect(page.getByTestId('nb-vis-step-text')).toHaveCount(0);

    // A divisor again makes the trace come back.
    await page.getByTestId('nb-b-input-10').fill('2');
    await expect(page.getByTestId('nb-vis-error')).toHaveCount(0);
    await expect(page.getByTestId('nb-vis-table')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });

  test('signed division truncates toward zero and shows the sign as its own step', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    await page.getByTestId('nb-op-picker').selectOption('divide');
    await page.getByTestId('nb-op-signed').check();
    await page.getByTestId('nb-input-10').fill('-7');
    await page.getByTestId('nb-b-input-10').fill('2');

    // -7 / 2 is -3 (toward zero), not -4 (toward minus infinity).
    await expect(page.getByTestId('nb-vis-signed')).toHaveText('-3');
    await expect(page.getByTestId('nb-vis-signed-note')).toContainText("answer's BITS");

    // Ten steps: the magnitudes preamble, eight quotient bits, and the signs.
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 1 of 10');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('magnitudes 7 and 2');
    for (let i = 0; i < 9; i++) await page.getByTestId('nb-vis-step-next').click();
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('TOWARD ZERO');
    await expect(page.getByTestId('nb-vis-step-next')).toBeDisabled();

    // Unsigned is a different answer entirely, from the same bits.
    await page.getByTestId('nb-op-signed').uncheck();
    await expect(page.getByTestId('nb-vis-dec')).toHaveText('124');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('multiplication shows the bits that fall off the width', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    await page.getByTestId('nb-op-picker').selectOption('multiply');
    await page.getByTestId('nb-input-16').fill('ff');
    await page.getByTestId('nb-b-input-16').fill('ff');

    // 255 * 255 is 65025; a byte keeps 0x01.
    await expect(page.getByTestId('nb-vis-hex')).toHaveText('01');
    await expect(page.getByTestId('nb-vis-flag-truncated')).toContainText('Bits dropped: yes');

    // At the last step there is one partial product per set bit, and seven
    // columns drawn outside the width for the bits that fell off it.
    for (let i = 0; i < 7; i++) await page.getByTestId('nb-vis-step-next').click();
    const table = page.getByTestId('nb-vis-table');
    await expect(table.locator('tbody th', { hasText: 'a << 7' })).toBeVisible();
    await expect(table.locator('thead th.outside')).toHaveAttribute('colspan', '7');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('separates an arithmetic right shift from a logical one', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    await page.getByTestId('nb-input-10').fill('-8');
    await page.getByTestId('nb-b-input-10').fill('1');

    await page.getByTestId('nb-op-picker').selectOption('shr');
    await expect(page.getByTestId('nb-vis-signed')).toHaveText('124'); // the sign is gone
    await expect(page.getByTestId('nb-b-label')).toContainText('Shift amount');

    await page.getByTestId('nb-op-picker').selectOption('sar');
    await expect(page.getByTestId('nb-vis-signed')).toHaveText('-4'); // -8 halved
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('sign bit');

    // Past the width the answer is still given, with C's rule named.
    await page.getByTestId('nb-op-picker').selectOption('shl');
    await page.getByTestId('nb-b-input-10').fill('8');
    await expect(page.getByTestId('nb-vis-dec')).toHaveText('0');
    await expect(page.getByTestId('nb-vis-flag-undefined-in-c')).toContainText(
      'Undefined in C: yes'
    );

    expect(await app.dumpAll()).toEqual(before);
  });

  test('the width governs the trace, and shrinking it truncates both operands', async ({
    app,
  }) => {
    const { page } = app;
    await app.goto('/tools/number-conversion/');
    const before = await app.dumpAll();

    await page.getByTestId('nb-width').selectOption('16');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('of 16');
    await expect(page.getByTestId('nb-b-input-2')).toHaveValue('0000000000000011');

    await page.getByTestId('nb-b-input-16').fill('0101');
    await page.getByTestId('nb-width').selectOption('8');
    // The high byte is dropped, like a register move — and the trace follows.
    await expect(page.getByTestId('nb-b-input-16')).toHaveValue('01');
    await expect(page.getByTestId('nb-vis-step-text')).toContainText('Step 1 of 8');

    expect(await app.dumpAll()).toEqual(before);
  });
});

test.describe('photography', () => {
  test('equivalent settings match the plan example, computing writes nothing', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/photography/');
    const before = await app.dumpAll();

    // Defaults: Micro 4/3, 20mm f/2.8 1/125 ISO 200 — the plan's worked example.
    await expect(page.getByTestId('ph-eq-ff-focal')).toHaveText('40mm');
    await expect(page.getByTestId('ph-eq-ff-aperture')).toHaveText('f/5.6');
    await expect(page.getByTestId('ph-eq-ff-iso')).toHaveText('ISO 800');

    // APS-C row snaps to the 1/3-stop scale (26.7mm → 27mm, f/3.73 → f/3.5,
    // ISO 355 → 320).
    await expect(page.getByTestId('ph-eq-apsc-focal')).toHaveText('27mm');
    await expect(page.getByTestId('ph-eq-apsc-aperture')).toHaveText('f/3.5');
    await expect(page.getByTestId('ph-eq-apsc-iso')).toHaveText('ISO 320');

    // Live recompute: halving ISO halves every equivalent ISO.
    await page.getByTestId('ph-iso').fill('100');
    await expect(page.getByTestId('ph-eq-ff-iso')).toHaveText('ISO 400');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('light stops: exact per-component and total differences', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/photography/');
    const before = await app.dumpAll();

    // A (defaults): m4/3 f/2.8 1/125 ISO 200. B: APS-C, same settings —
    // sensor area is the only difference: 2·log2(2.0/1.5) ≈ 0.83.
    await page.getByTestId('ph-b-format').selectOption('apsc');
    await expect(page.getByTestId('ph-stops-shutter')).toHaveText('0');
    await expect(page.getByTestId('ph-stops-aperture')).toHaveText('0');
    await expect(page.getByTestId('ph-stops-sensor')).toHaveText('+0.83');
    await expect(page.getByTestId('ph-stops-exposure')).toContainText('0 stops');
    await expect(page.getByTestId('ph-stops-light')).toContainText('−0.83');

    // Shutter: B at 1/250 → A stays open twice as long → +1 stop.
    await page.getByTestId('ph-b-shutter').fill('1/250');
    await expect(page.getByTestId('ph-stops-shutter')).toHaveText('+1');

    // Aperture: B at f/4 → 2·log2(2.8/4) ≈ −1.03.
    await page.getByTestId('ph-b-aperture').fill('4');
    await expect(page.getByTestId('ph-stops-aperture')).toHaveText('−1.03');

    expect(await app.dumpAll()).toEqual(before);
  });

  test('picking a sensor format writes only the preferences singleton and survives reload', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/photography/');
    const before = await app.dumpAll();

    await page.getByTestId('ph-format').selectOption('apsc-canon');
    await expect
      .poll(async () => (await app.get('preferences', 'singleton'))?.photo_last_format)
      .toBe('apsc-canon');
    const after = await app.dumpAll();
    assertIsolatedDelta(before, after, [{ store: 'preferences', id: 'singleton' }]);

    // The Canon 1.6 crop drives the math immediately: FF 20×1.6 = 32mm,
    // m4/3 20×1.6/2.0 = 16mm.
    await expect(page.getByTestId('ph-eq-ff-focal')).toHaveText('32mm');
    await expect(page.getByTestId('ph-eq-mft-focal')).toHaveText('16mm');

    // Restored on the next visit — and the reload itself writes nothing.
    await app.goto('/tools/photography/');
    await expect(page.getByTestId('ph-format')).toHaveValue('apsc-canon');
    expect(await app.dumpAll()).toEqual(after);
  });
});

test.describe('file transfer', () => {
  test('estimates across unit combinations with zero DB writes', async ({ app }) => {
    const { page } = app;
    await app.goto('/tools/file-transfer/');
    const before = await app.dumpAll();

    // Default 1 GB over 100 Mbps: 8×10⁹ bits / 10⁸ bps = 80 s.
    await expect(page.getByTestId('ft-time')).toHaveText('1 min 20 s');
    await expect(page.getByTestId('ft-speed-both')).toHaveText('100 Mbps = 12.5 MB/s');

    // Byte-based unit: 100 MB/s moves the same GB in 10 s.
    await page.getByTestId('ft-speed-unit').selectOption('MBps');
    await expect(page.getByTestId('ft-time')).toHaveText('10 s');

    // Overhead trims the effective link: 80 s / 0.8 = 100 s.
    await page.getByTestId('ft-speed-unit').selectOption('Mbps');
    await page.getByTestId('ft-overhead').fill('20');
    await expect(page.getByTestId('ft-time')).toHaveText('1 min 40 s');
    await expect(page.getByTestId('ft-speed-effective')).toContainText('80 Mbps');

    // TB over Kbps — the long tail formats in days.
    await page.getByTestId('ft-overhead').fill('0');
    await page.getByTestId('ft-size').fill('1');
    await page.getByTestId('ft-size-unit').selectOption('TB');
    await page.getByTestId('ft-speed').fill('512');
    await page.getByTestId('ft-speed-unit').selectOption('Kbps');
    await expect(page.getByTestId('ft-time')).toHaveText('180 d 20 h');

    // Impossible input drops the estimate instead of showing a stale one.
    await page.getByTestId('ft-speed').fill('0');
    await expect(page.getByTestId('ft-time')).toHaveCount(0);
    await expect(page.getByRole('alert')).toBeVisible();

    expect(await app.dumpAll()).toEqual(before);
  });
});

test('explainer drop-downs toggle from the keyboard on every calculator page', async ({ app }) => {
  const { page } = app;
  const targets = [
    { path: '/tools/number-conversion/', testid: 'explainer-twos', text: 'Flip every bit, then add 1' },
    { path: '/tools/photography/', testid: 'explainer-equivalence', text: 'brightness of the picture' },
    { path: '/tools/file-transfer/', testid: 'explainer-bits-bytes', text: 'One byte is 8 bits' },
  ];
  for (const t of targets) {
    await app.goto(t.path);
    const details = page.getByTestId(t.testid);
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', true);
    await expect(details.getByText(t.text)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
  }
});
