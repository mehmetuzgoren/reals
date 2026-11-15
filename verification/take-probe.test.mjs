import assert from 'node:assert/strict';
import test from 'node:test';
import { ConvexProbe, ProbeFailure, lockedToday, runProbe, validateManifest } from './take-probe.mjs';

const manifest = {
  convexUrl: 'https://example.convex.cloud', siteUrl: 'https://example.convex.site',
  roundId: 'round', originalId: 'original', replyId: 'reply',
};
const tokens = { casey: 'casey-token', dana: 'dana-token', locked: 'locked-token' };
const profile = { id: 'author', username: 'author', displayName: 'Author', avatar: null };
const original = {
  id: 'original', roundId: 'round', author: profile, optionId: 'yes', publishedAt: 1000,
  durationMs: 1000, thumbnailAssetId: null, visibleReplyCount: 1,
};
const reply = {
  id: 'reply', originalId: 'original', roundId: 'round', author: profile, publishedAt: 1000,
  durationMs: 1000, thumbnailAssetId: null,
};
const round = {
  id: 'round', question: 'Do you like pineapple on pizza?', options: [{ id: 'yes', label: 'Yes' }],
  opensAt: 1000, closesAt: null, isCurrent: true,
};
const safeToday = {
  serverNow: 1000, round, viewerReceipt: null,
  canViewFriends: false, ownOriginal: null, friendPresence: [{ profile, hasPublished: true }],
};
const success = (value) => Response.json({ status: 'success', value });
const denied = () => Response.json({ status: 'error', errorData: {
  code: 'NOT_FOUND', message: 'Content unavailable', retryable: false,
} });
const grant = () => ({ url: `${manifest.siteUrl}/v1/media/grant?token=secret`, expiresAt: Date.now() + 60_000 });

function transport(transform = (value) => value) {
  return async (url, init = {}) => {
    if (url.startsWith(`${manifest.siteUrl}/v1/media/`)) {
      if (url.includes('invalid-probe-token')) return new Response('Unavailable', { status: 404 });
      const headers = { 'content-type': 'video/mp4', 'cache-control': 'private, no-store', 'content-length': '4' };
      if (init.method === 'HEAD') return new Response(null, { headers });
      return new Response(new Uint8Array([0]), { status: 206, headers: {
        ...headers, 'content-length': '1', 'content-range': 'bytes 0-0/4',
      } });
    }
    const { path, args } = JSON.parse(init.body);
    const identity = Object.keys(tokens).find((name) => init.headers.Authorization === `Bearer ${tokens[name]}`);
    assert.ok(identity);
    let value;
    if (path === 'rounds:today') value = identity === 'locked' ? structuredClone(safeToday) : {
      ...safeToday, round, viewerReceipt: { roundId: 'round', publishedAt: 1000, originalId: null }, canViewFriends: true,
    };
    if (path === 'takes:feed') value = { items: identity === 'locked' ? [] : [
      { ...original, visibleReplyCount: identity === 'casey' ? 1 : 0 },
    ], nextCursor: null };
    if (path === 'takes:detail') {
      if (identity === 'locked') return denied();
      value = { ...original, visibleReplyCount: identity === 'casey' ? 1 : 0 };
    }
    if (path === 'replies:list') {
      if (identity === 'locked') return denied();
      value = { items: identity === 'casey' ? [reply] : [], nextCursor: null };
    }
    if (path === 'captions:get' || path === 'media:createPlaybackGrant') {
      if (identity === 'locked' || (identity === 'dana' && args.kind === 'reply')) return denied();
      value = path === 'captions:get' ? { status: 'unavailable', text: null } : grant();
    }
    assert.notEqual(value, undefined);
    return success(transform(value, path, identity));
  };
}

test('manifest rejects credentials, HTTP, paths, unknown keys and overlapping IDs', () => {
  for (const invalid of [
    { convexUrl: 'http://example.convex.cloud' }, { siteUrl: 'https://u:p@example.com' },
    { siteUrl: 'https://example.com/path' }, { siteUrl: 'https://example.com?token=x' },
    { siteUrl: 'https://example.com/#x' }, { token: 'never-here' }, { replyId: 'original' },
  ]) assert.throws(() => validateManifest({ ...manifest, ...invalid }));
  assert.deepEqual(validateManifest(manifest), manifest);
});

test('requires three distinct secure tokens without including them in diagnostics', () => {
  assert.throws(() => new ConvexProbe(manifest, { ...tokens, dana: tokens.casey }), ProbeFailure);
  assert.throws(() => new ConvexProbe(manifest, { ...tokens, locked: '' }), ProbeFailure);
  assert.ok(!new ProbeFailure().message.includes(tokens.casey));
});

test('uses the documented Convex HTTP envelope and never follows redirects with a bearer token', async () => {
  const probe = new ConvexProbe(manifest, tokens, async (url, init) => {
    assert.equal(url, `${manifest.convexUrl}/api/query`);
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, 'Bearer casey-token');
    assert.deepEqual(JSON.parse(init.body), { path: 'rounds:today', args: {}, format: 'json' });
    return success(safeToday);
  });
  await probe.value('query', 'rounds:today', {}, 'casey');
});

test('network, non-JSON, wrong-code, and missing-function errors cannot pass an authorization denial', async () => {
  for (const fetcher of [
    async () => { throw new Error('network'); },
    async () => new Response('Not Found', { status: 404 }),
    async () => Response.json({ status: 'error', errorData: { code: 'INVALID_ARGS' } }),
    async () => Response.json({ status: 'error', errorMessage: 'Function missing' }),
  ]) {
    await assert.rejects(() => new ConvexProbe(manifest, tokens, fetcher).denied('query', 'takes:detail', {}, 'locked'));
  }
});

test('locked Today rejects direct and nested content leaks', () => {
  lockedToday(safeToday, 'round');
  assert.throws(() => lockedToday({ ...safeToday, thumbnailAssetId: 'private' }, 'round'), ProbeFailure);
  assert.throws(() => lockedToday({ ...safeToday, friendPresence: [
    { profile: { ...profile, position: 'Yes' }, hasPublished: true },
  ] }, 'round'), ProbeFailure);
  assert.throws(() => lockedToday({ ...safeToday, round: {
    ...round, privateTake: { position: 'Yes', thumbnailAssetId: 'hidden' },
  } }, 'round'), ProbeFailure);
  assert.throws(() => lockedToday({ ...safeToday, round: {
    ...round, options: [{ ...round.options[0], privateReply: 'hidden' }],
  } }, 'round'), ProbeFailure);
});

test('response logs, unexpected envelope fields and revealing denial text cannot pass', async () => {
  const failure = { code: 'NOT_FOUND', message: 'Content unavailable', retryable: false };
  for (const value of [
    { status: 'success', value: safeToday, logLines: ['private caption'] },
    { status: 'success', value: safeToday, privateReply: 'hidden' },
    { status: 'error', errorData: failure, logLines: ['private caption'] },
    { status: 'error', errorData: failure, errorMessage: 'Blair said Yes' },
    { status: 'error', errorData: { ...failure, message: 'Blair said Yes' } },
    { status: 'error', errorData: { ...failure, privateAuthor: 'Blair' } },
  ]) {
    const probe = new ConvexProbe(manifest, tokens, async () => Response.json(value));
    await assert.rejects(() => probe.call('query', 'takes:detail', {}, 'locked'), ProbeFailure);
  }
  await new ConvexProbe(manifest, tokens, async () => Response.json({
    status: 'error', errorData: failure, errorMessage: 'Content unavailable', logLines: [],
  })).denied('query', 'takes:detail', {}, 'locked');
});

test('pagination follows cursors and detects cycles', async () => {
  let calls = 0;
  const probe = new ConvexProbe(manifest, tokens, async (_, init) => {
    calls++;
    const { args } = JSON.parse(init.body);
    return success({ items: [{ ...original, id: `item-${calls}` }], nextCursor: args.cursor === null ? 'next' : null });
  });
  assert.deepEqual((await probe.page('takes:feed', {}, 'casey')).map((item) => item.id), ['item-1', 'item-2']);
  const cyclic = new ConvexProbe(manifest, tokens, async () => success({ items: [], nextCursor: 'repeat' }));
  await assert.rejects(() => cyclic.page('takes:feed', {}, 'casey'), ProbeFailure);
});

test('rejects permanent storage origins and grants beyond the bounded clock allowance', async () => {
  for (const value of [
    { ...grant(), url: 'https://other.convex.cloud/api/storage/id' },
    { ...grant(), expiresAt: Date.now() + 120_000 },
    { ...grant(), expiresAt: Date.now() - 1000 },
  ]) {
    const probe = new ConvexProbe(manifest, tokens, async () => success(value));
    await assert.rejects(() => probe.grant('original', 'original', 'casey'), ProbeFailure);
  }
});

test('HEAD, exact single-byte Range, no-store and corrupt-token denial are all required', async () => {
  const probe = new ConvexProbe(manifest, tokens, transport());
  await probe.media(grant());
  for (const fetcher of [
    async () => new Response(null, { status: 302, headers: { location: 'https://raw-storage.invalid' } }),
    async () => new Response(null, { headers: { 'content-type': 'video/mp4', 'content-length': '4', 'cache-control': 'public' } }),
    async (_, init) => init.method === 'HEAD' ? new Response(null, { headers: {
      'content-type': 'video/mp4', 'content-length': '4', 'cache-control': 'private, no-store',
    } }) : new Response(new Uint8Array([0]), { status: 200 }),
  ]) await assert.rejects(() => new ConvexProbe(manifest, tokens, fetcher).media(grant()), ProbeFailure);
});

test('full mock transport exercises the probe, not the product', async () => {
  const results = await runProbe(new ConvexProbe(manifest, tokens, transport()));
  assert.equal(results.length, 25);
  assert.ok(results.every((row) => row.passed));
});

test('media HEAD length obeys the delivered 8 MiB application cap', async () => {
  for (const total of [8 * 1024 * 1024, 8 * 1024 * 1024 + 1]) {
    const base = transport();
    const probe = new ConvexProbe(manifest, tokens, async (url, init) => {
      const response = await base(url, init);
      if (init.method === 'HEAD') response.headers.set('content-length', String(total));
      if (response.status === 206) response.headers.set('content-range', `bytes 0-0/${total}`);
      return response;
    });
    if (total === 8 * 1024 * 1024) await probe.media(grant());
    else await assert.rejects(() => probe.media(grant()), ProbeFailure);
  }
});

test('Dana hidden-count/content leak and a reply in the main feed fail independently', async () => {
  const results = await runProbe(new ConvexProbe(manifest, tokens, transport((value, path, identity) => {
    if (path === 'takes:feed' && identity === 'dana') return { items: [original, reply], nextCursor: null };
    if (path === 'replies:list' && identity === 'dana') return { items: [reply], nextCursor: null };
    return value;
  })));
  assert.equal(results.find((row) => row.id === 'dana.original-only-feed').passed, false);
  assert.equal(results.find((row) => row.id === 'dana.filtered-flat-replies').passed, false);
  assert.equal(results.find((row) => row.id === 'casey.filtered-flat-replies').passed, true);
});

test('every consumed success DTO rejects unknown fields before any projection or denial assertion', async () => {
  for (const [path, identity, id] of [
    ['takes:feed', 'locked', 'locked.no-feed'],
    ['takes:feed', 'dana', 'dana.original-only-feed'],
    ['takes:detail', 'dana', 'dana.detail-visible-count'],
    ['replies:list', 'dana', 'dana.filtered-flat-replies'],
    ['rounds:today', 'locked', 'locked.safe-today'],
    ['captions:get', 'casey', 'casey.reply-direct-caption'],
    ['media:createPlaybackGrant', 'casey', 'casey.reply-direct-video'],
  ]) {
    const results = await runProbe(new ConvexProbe(manifest, tokens, transport((value, actualPath, actualIdentity) => {
      if (actualPath === path && actualIdentity === identity) return { ...value, hiddenReply: { caption: 'private', author: 'hidden' } };
      return value;
    })));
    assert.equal(results.find((row) => row.id === id).passed, false);
  }
});

test('nested content/profile leaks and omitted required nulls are rejected', async () => {
  for (const altered of [
    { ...original, author: { ...profile, position: 'private' } },
    { ...original, hiddenReply: 'private' },
    { ...original, thumbnailAssetId: undefined },
  ]) {
    const probe = new ConvexProbe(manifest, tokens, async () => success(altered));
    await assert.rejects(() => probe.value('query', 'takes:detail', {}, 'dana'), ProbeFailure);
  }
});
