import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ProbeFailure, validateMediaDenial, validateConvexErrorMessage } from './take-probe.mjs';

function check(condition) {
  if (!condition) throw new ProbeFailure();
}

export function deploymentOrigins(value) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).length === 2);
  const result = {};
  for (const key of ['convexUrl', 'siteUrl']) {
    check(typeof value[key] === 'string');
    const url = new URL(value[key]);
    check(url.protocol === 'https:' && !url.username && !url.password);
    check(url.pathname === '/' && !url.search && !url.hash);
    result[key] = url.origin;
  }
  check(result.convexUrl !== result.siteUrl);
  return result;
}

export async function runDeploymentProbe(manifest, fetcher = fetch, report = () => {}) {
  const { convexUrl, siteUrl } = deploymentOrigins(manifest);
  const rows = [];
  const step = async (id, action) => {
    try {
      await action();
      rows.push({ id, passed: true });
    } catch {
      rows.push({ id, passed: false });
    }
    report(rows.at(-1));
  };
  const api = async (kind, path, args, expectedCode = null) => {
    const response = await fetcher(`${convexUrl}/api/${kind}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    check(response.status === 200 && !response.headers.has('location'));
    const data = await response.json();
    check(data && typeof data === 'object' && !Array.isArray(data));
    check(data.logLines === undefined || (Array.isArray(data.logLines) && data.logLines.length === 0));
    const allowed = expectedCode ? ['status', 'errorMessage', 'errorData', 'logLines'] : ['status', 'value', 'logLines'];
    check(Object.keys(data).every(key => allowed.includes(key)));
    if (!expectedCode) {
      check(data.status === 'success' && data.value === false);
      return;
    }
    check(data.status === 'error' && data.errorData?.code === expectedCode);
    check(Object.keys(data.errorData).length === 3);
    check(data.errorData.message === (expectedCode === 'UNAUTHENTICATED'
      ? 'Sign in with Apple to continue' : 'Apple sign-in is not configured'));
    check(data.errorData.retryable === false);
    const frames = expectedCode === 'PROCESSING_UNAVAILABLE'
      ? [['fail', '../../convex/lib/errors.ts'], ['requireApple', '../convex/auth.ts'], ['handler', '../convex/auth.ts']]
      : [
        ['fail', '../../convex/lib/errors.ts'], ['identity', '../../convex/lib/auth.ts'],
        ['authenticatedUser', '../../convex/lib/auth.ts'], ['optionalViewer', '../../convex/lib/auth.ts'],
        ...(path === 'viewer:session' ? [] : [['viewer', '../../convex/lib/auth.ts']]),
        ['handler', `../convex/${path.split(':')[0]}.ts`],
      ];
    validateConvexErrorMessage(data.errorMessage, data.errorData, [frames]);
  };
  await step('auth.unauthenticated-session', () => api('query', 'auth:isAuthenticated', {}));
  for (const path of ['viewer:session', 'rounds:today']) {
    await step(`${path}.unauthenticated-denied`, () => api('query', path, {}, 'UNAUTHENTICATED'));
  }
  await step('devices.apns-shape-reaches-auth-guard', () => api('mutation', 'devices:register', {
    installationId: 'deployment-probe', token: 'ab'.repeat(32), platform: 'ios', notificationsEnabled: false,
  }, 'UNAUTHENTICATED'));
  const state = 'A'.repeat(43);
  const code = 'B'.repeat(43);
  await step('apple.unconfigured-start-denied', () => api('mutation', 'auth:startSignInWithApple', {
    redirectTo: `${siteUrl}/auth/ios?state=${state}`,
  }, 'PROCESSING_UNAVAILABLE'));
  await step('apple.unconfigured-completion-denied', () => api('mutation', 'auth:completeSignInWithApple', {
    state, code,
  }, 'PROCESSING_UNAVAILABLE'));
  for (const [id, query, outcome] of [
    ['missing-state', `convexAuthCode=${code}`, null],
    ['duplicate-state', `state=${state}&state=${state}&convexAuthCode=${code}`, null],
    ['malformed-state', `state=bad&convexAuthCode=${code}`, null],
    ['missing-outcome', `state=${state}`, null],
    ['duplicate-code', `state=${state}&convexAuthCode=${code}&convexAuthCode=${code}`, null],
    ['conflicting-outcomes', `state=${state}&convexAuthCode=${code}&convexAuthError=access_denied`, null],
    ['malformed-code', `state=${state}&convexAuthCode=bad`, null],
    ['unknown-error', `state=${state}&convexAuthError=unexpected`, null],
    ['fixed-code-destination', `state=${state}&convexAuthCode=${code}&redirectTo=https%3A%2F%2Fexample.invalid`, ['code', code]],
    ['fixed-error-destination', `state=${state}&convexAuthError=access_denied`, ['error', 'access_denied']],
  ]) {
    await step(`relay.${id}`, async () => {
      const response = await fetcher(`${siteUrl}/auth/ios?${query}`, {
        redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      check(response.headers.get('cache-control') === 'no-store');
      check(response.headers.get('referrer-policy') === 'no-referrer');
      if (!outcome) {
        check(response.status === 400 && !response.headers.has('location'));
      } else {
        check(response.status === 302);
        const target = new URL(response.headers.get('location'));
        check(target.protocol === 'take:' && target.hostname === 'auth' && target.pathname === '/convex');
        check(!target.username && !target.password && !target.port && !target.hash);
        check([...target.searchParams].length === 2);
        check(target.searchParams.get('state') === state && target.searchParams.get(outcome[0]) === outcome[1]);
      }
      check(await response.text() === (outcome ? '' : 'Invalid authentication callback'));
    });
  }
  await step('apple.callback-post-route-present', async () => {
    const response = await fetcher(`${siteUrl}/oauth/apple/callback`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '',
    });
    check(response.status === 400 && !response.headers.has('location'));
    await response.body?.cancel();
  });
  for (const method of ['GET', 'HEAD']) {
    await step(`media.invalid-grant-${method.toLowerCase()}-denied`, async () => {
      const response = await fetcher(`${siteUrl}/v1/media/probe-invalid?token=invalid`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      check(response.status === 404 && !response.headers.has('location'));
      const cache = response.headers.get('cache-control')?.split(',').map(value => value.trim());
      check(cache?.includes('private') && cache.includes('no-store'));
      check(!response.headers.get('content-type')?.startsWith('video/'));
      validateMediaDenial(await response.text());
    });
  }
  return rows;
}

async function main() {
  try {
    check(process.argv.length === 3);
    const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const rows = await runDeploymentProbe(manifest, fetch, ({ id, passed }) => console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`));
    console.log(`${rows.filter(row => row.passed).length}/${rows.length} deployed boundary assertions passed; no signed-in or valid-media acceptance`);
    process.exitCode = rows.every(row => row.passed) ? 0 : 1;
  } catch {
    console.error('Deployment probe setup/transport failed; response data was not logged.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
