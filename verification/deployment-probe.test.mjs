import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentOrigins, runDeploymentProbe } from './deployment-probe.mjs';
import { validateMediaDenial } from './take-probe.mjs';

const manifest = { convexUrl: 'https://test.convex.cloud', siteUrl: 'https://test.convex.site' };

function transport(change = response => response) {
  return async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers?.Authorization, undefined);
    let response;
    if (url.origin === manifest.convexUrl) {
      const { path } = JSON.parse(options.body);
      const code = path.includes('SignInWithApple') ? 'PROCESSING_UNAVAILABLE' : 'UNAUTHENTICATED';
      response = Response.json(path === 'auth:isAuthenticated'
        ? { status: 'success', value: false }
        : { status: 'error', errorData: { code, message: 'Unavailable', retryable: false } });
    } else if (url.pathname === '/auth/ios') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('convexAuthCode');
      const error = url.searchParams.get('convexAuthError');
      const valid = url.searchParams.getAll('state').length === 1 && /^[A-Za-z0-9_-]{43}$/.test(state)
        && url.searchParams.getAll('convexAuthCode').length <= 1
        && (code === null) !== (error === null)
        && (code ? /^[A-Za-z0-9_-]{43}$/.test(code) : error === 'access_denied');
      const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
      if (valid) headers.Location = `take://auth/convex?state=${state}&${code ? 'code' : 'error'}=${code ?? error}`;
      response = new Response(null, { status: valid ? 302 : 400, headers });
    } else if (url.pathname === '/oauth/apple/callback') {
      assert.equal(options.method, 'POST');
      response = new Response(null, { status: 400 });
    } else {
      response = new Response(options.method === 'HEAD' ? null : 'Not found', {
        status: 404, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return change(response, url, options);
  };
}

test('development boundary probe checks actual paths without credentials or redirects', async () => {
  const rows = await runDeploymentProbe(manifest, transport());
  assert.equal(rows.length, 19);
  assert.ok(rows.every(row => row.passed));
});

test('deployment origins reject secret-bearing URLs and unexpected fields', () => {
  for (const invalid of [
    { ...manifest, siteUrl: 'http://test.convex.site' },
    { ...manifest, convexUrl: 'https://secret@test.convex.cloud' },
    { ...manifest, siteUrl: `${manifest.siteUrl}/path` },
    { ...manifest, siteUrl: `${manifest.siteUrl}?token=secret` },
    { ...manifest, siteUrl: manifest.convexUrl },
    { ...manifest, token: 'secret' },
  ]) assert.throws(() => deploymentOrigins(invalid));
});

test('network errors cannot pass as authorization denials', async () => {
  const rows = await runDeploymentProbe(manifest, async () => { throw new Error('private diagnostic'); });
  assert.ok(rows.every(row => !row.passed));
  assert.ok(!JSON.stringify(rows).includes('private diagnostic'));
});

test('Apple placeholder success and missing callback route fail', async () => {
  const rows = await runDeploymentProbe(manifest, transport((response, url, options) => {
    if (url.pathname === '/oauth/apple/callback') return new Response(null, { status: 404 });
    if (options.body?.includes('SignInWithApple')) return Response.json({ status: 'success', value: {} });
    return response;
  }));
  assert.equal(rows.filter(row => !row.passed).length, 3);
});

test('relay cannot redirect elsewhere, forward extra fields or omit privacy headers', async () => {
  for (const location of [
    'https://example.invalid/',
    `take://auth/convex?state=${'A'.repeat(43)}&code=${'B'.repeat(43)}&extra=leak`,
  ]) {
    const rows = await runDeploymentProbe(manifest, transport((response, url) => url.pathname === '/auth/ios' && response.status === 302
      ? new Response(null, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', Location: location } })
      : response));
    assert.equal(rows.filter(row => !row.passed).length, 2);
  }
  const rows = await runDeploymentProbe(manifest, transport((response, url) => url.pathname === '/auth/ios'
    ? new Response(null, { status: 400 }) : response));
  assert.equal(rows.filter(row => !row.passed).length, 10);
});

test('wrong error codes, extra envelope data and client logs fail', async () => {
  for (const body of [
    { status: 'error', errorData: { code: 'INVALID_ARGUMENT', message: 'Unavailable', retryable: false } },
    { status: 'error', errorData: { code: 'UNAUTHENTICATED', message: 'Unavailable', retryable: false }, extra: 'private' },
    { status: 'error', errorData: { code: 'UNAUTHENTICATED', message: 'Unavailable', retryable: false }, logLines: ['private'] },
  ]) {
    const rows = await runDeploymentProbe(manifest, transport((response, url) => url.origin === manifest.convexUrl ? Response.json(body) : response));
    assert.equal(rows.filter(row => !row.passed).length, 6);
  }
});

test('invalid media must stay private, generic and unavailable', async () => {
  const rows = await runDeploymentProbe(manifest, transport((response, url) => url.pathname.startsWith('/v1/media/')
    ? new Response('private diagnostic', { status: 404 }) : response));
  assert.equal(rows.filter(row => !row.passed).length, 2);
});

test('actual structured HTTP denial accepts only the exact generic failure envelope', () => {
  const failure = { code: 'NOT_FOUND', message: 'Not found', retryable: false };
  assert.doesNotThrow(() => validateMediaDenial(JSON.stringify({ failure })));
  for (const body of [
    { failure, storageId: 'private' },
    { failure: { ...failure, author: 'private' } },
    { failure: { ...failure, message: 'Private take by someone' } },
    { failure: { ...failure, code: 'INVALID_ARGUMENT' } },
    { failure: { ...failure, retryable: true } },
    { failure: { code: 'NOT_FOUND', message: 'Not found' } },
    { error: 'Not found' },
  ]) assert.throws(() => validateMediaDenial(JSON.stringify(body)));
  assert.throws(() => validateMediaDenial('private diagnostic'));
});
