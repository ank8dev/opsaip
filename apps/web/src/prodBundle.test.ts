// The production build must not contain the sample team: users never see demo data.
// This builds the app the way `npm run build` does, into a temporary folder.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_ENABLED } from './data/source';
import { mockWorkspace } from './mocks';

const webDir = resolve(__dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'opsaip-prod-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)]));
}

describe('demo data', () => {
  it('is enabled in tests (and dev)', () => {
    expect(DEMO_ENABLED).toBe(true);
  });

  it('is not in the production bundle', () => {
    execFileSync(
      process.execPath,
      [resolve(webDir, '../../node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: webDir, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
    );
    const js = filesIn(out).filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    const code = js.map((f) => readFileSync(f, 'utf8')).join('\n');
    // A person and a task title from the sample team in src/mocks (checked to still be there).
    const person = mockWorkspace.team[0].name;
    const title = mockWorkspace.activity[0].task;
    expect(person.length).toBeGreaterThan(3);
    expect(title.length).toBeGreaterThan(10);
    expect(code).not.toContain(person);
    expect(code).not.toContain(title);
  }, 120_000);
});
