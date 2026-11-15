import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, HARD_LIMITS, VerificationError } from '../src/config.mjs';
import { runProcess, checkExecutables } from '../src/process.mjs';

const secret = 'test-only-configuration-secret-0000000000000000';

test('missing, short, excessive, and header-unsafe secrets fail closed', () => {
  for (const value of [undefined, '', 'short', 'a'.repeat(513), 'a'.repeat(32) + '\n', 'a'.repeat(32) + ' ']) {
    assert.throws(() => loadConfig({ VERIFY_SHARED_SECRET: value }), /VERIFY_SHARED_SECRET/);
  }
  assert.equal(loadConfig({ VERIFY_SHARED_SECRET: secret }).secret, secret);
});

test('all configurable limits are positive and cannot raise hard caps', () => {
  for (const [key, value] of Object.entries({
    VERIFY_MAX_BYTES: HARD_LIMITS.videoBytes + 1,
    VERIFY_MAX_AVATAR_BYTES: HARD_LIMITS.avatarBytes + 1,
    VERIFY_MAX_DURATION_MS: 15_001,
    VERIFY_MAX_CONCURRENCY: 5,
    VERIFY_MAX_CONNECTIONS: 65,
    VERIFY_REQUEST_TIMEOUT_MS: 30_001,
    VERIFY_BODY_TIMEOUT_MS: 10_001,
    VERIFY_PROCESS_TIMEOUT_MS: 10_001,
    PORT: 65_536,
  })) {
    for (const invalid of [String(value), '0', '-1', 'Infinity', '1.5', '']) {
      assert.throws(() => loadConfig({ VERIFY_SHARED_SECRET: secret, [key]: invalid }), new RegExp(key));
    }
  }
  const config = loadConfig({ VERIFY_SHARED_SECRET: secret, VERIFY_REQUEST_TIMEOUT_MS: '20' });
  assert.equal(config.bodyTimeoutMs, 20);
  assert.equal(config.processTimeoutMs, 20);
});

test('real ffprobe and ffmpeg executables are usable', checkExecutables);

test('process wall-clock deadline kills and reaps a real child', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 }), (error) => error instanceof VerificationError && error.code === 'VERIFICATION_TIMEOUT');
});

test('excessive child output is bounded and the child is killed', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(65536)); setInterval(() => {}, 1000)'], { timeoutMs: 2000, maxOutputBytes: 1024 }), (error) => error.code === 'INVALID_MEDIA');
});

test('abort terminates a running process and returns the abort reason', async () => {
  const controller = new AbortController();
  const reason = new VerificationError(408, 'REQUEST_TIMEOUT', 'test timeout');
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 2000, signal: controller.signal });
  setTimeout(() => controller.abort(reason), 40);
  await assert.rejects(pending, (error) => error === reason);
});

test('missing commands and failed processes fail closed without command output', async () => {
  await assert.rejects(runProcess('/does-not-exist', [], { timeoutMs: 1000 }), (error) => error.code === 'VERIFIER_UNAVAILABLE');
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("PRIVATE OUTPUT"); process.exit(1)'], { timeoutMs: 1000 }), (error) => error.code === 'INVALID_MEDIA' && !error.message.includes('PRIVATE'));
});
