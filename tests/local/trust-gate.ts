import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '.results');

/**
 * A green run only means something if the same run proved the oracle can go
 * red. This reporter fails the run when the sabotage cases did not execute, so
 * a filtered or accidentally-empty run is reported UNVERIFIED, never as a pass.
 */
export default class TrustGate implements Reporter {
  private results: { title: string; status: string; ms: number }[] = [];
  private sabotage = { ran: 0, detected: 0 };

  onTestEnd(test: TestCase, result: TestResult): void {
    const title = test.titlePath().filter(Boolean).join(' > ');
    this.results.push({ title, status: result.status, ms: result.duration });
    if (title.includes('sabotage:')) {
      this.sabotage.ran++;
      if (result.status === 'passed') this.sabotage.detected++;
    }
  }

  onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> | void {
    const failed = this.results.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
    const trustworthy = this.sabotage.ran > 0 && this.sabotage.detected === this.sabotage.ran;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, 'results.json'),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), sabotage: this.sabotage, trustworthy, results: this.results },
        null,
        2
      )
    );
    console.log(
      '\n' +
        (trustworthy
          ? 'self-verification ' + this.sabotage.detected + '/' + this.sabotage.ran + ' injected faults detected'
          : 'NOT TRUSTWORTHY — the sabotage cases did not run (' +
            this.sabotage.detected + '/' + this.sabotage.ran + ')')
    );
    console.log(failed.length + ' failed, ' + this.results.length + ' total');
    if (!trustworthy && result.status === 'passed') {
      return Promise.resolve({ status: 'failed' as const });
    }
  }
}
