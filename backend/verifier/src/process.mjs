import { spawn } from 'node:child_process';
import { HARD_LIMITS, VerificationError, invalidMedia } from './config.mjs';

export function runProcess(command, args, { signal, timeoutMs, maxOutputBytes = HARD_LIMITS.processOutputBytes }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let child;
    let failure;
    let outputBytes = 0;
    const output = [[], [], []];
    const stop = (error) => {
      if (failure) return;
      failure = error;
      if (child?.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (killError) {
          if (killError.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
    };
    const aborted = () => stop(signal.reason);

    try {
      child = spawn(command, args, {
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', AV_LOG_FORCE_NOCOLOR: '1' },
      });
    } catch {
      reject(new VerificationError(503, 'VERIFIER_UNAVAILABLE', 'Media verification is unavailable.'));
      return;
    }

    const timer = setTimeout(() => stop(new VerificationError(504, 'VERIFICATION_TIMEOUT', 'Media verification timed out.')), timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();

    for (const [index, stream] of [child.stdout, child.stderr, child.stdio[3]].entries()) {
      stream.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          stop(invalidMedia());
          return;
        }
        if (!failure) output[index].push(chunk);
      });
    }
    child.on('error', () => stop(new VerificationError(503, 'VERIFIER_UNAVAILABLE', 'Media verification is unavailable.')));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (failure) reject(failure);
      else if (code !== 0) reject(invalidMedia());
      else resolve({ stdout: Buffer.concat(output[0]), stderr: Buffer.concat(output[1]).toString('utf8'), progress: Buffer.concat(output[2]).toString('utf8') });
    });
  });
}

export async function checkExecutables() {
  for (const name of ['ffprobe', 'ffmpeg']) {
    const result = await runProcess(`/usr/bin/${name}`, ['-version'], { timeoutMs: 2000, maxOutputBytes: 32 * 1024 });
    const version = new RegExp(`^${name} version (\\d+)\\.(\\d+)`).exec(result.stdout.toString('utf8'));
    if (!version || Number(version[1]) < 6 || (Number(version[1]) === 6 && Number(version[2]) < 1)) throw new Error('ffmpeg and ffprobe version 6.1 or later are required.');
  }
}
