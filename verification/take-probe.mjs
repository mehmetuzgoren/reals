import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export class ProbeFailure extends Error {
  constructor() {
    super('Probe assertion failed; response data is intentionally withheld');
  }
}

function check(condition) {
  if (!condition) throw new ProbeFailure();
}

function keys(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(Object.keys(value).every((key) => allowed.includes(key)));
}

const text = (value) => check(typeof value === 'string' && value.length > 0);
const bool = (value) => check(typeof value === 'boolean');
const number = (value) => check(Number.isFinite(value));
const nullable = (validate) => (value) => { if (value !== null) validate(value); };
const list = (validate) => (value) => {
  check(Array.isArray(value));
  for (const item of value) validate(item);
};
const object = (fields) => (value) => {
  keys(value, Object.keys(fields));
  check(Object.keys(value).length === Object.keys(fields).length);
  for (const [field, validate] of Object.entries(fields)) validate(value[field]);
};
const profile = object({
  id: text, username: text, displayName: text, avatar: nullable(object({ url: text })),
});
const round = object({
  id: text, question: text, options: list(object({ id: text, label: text })),
  opensAt: number, closesAt: nullable(number), isCurrent: bool,
});
const receipt = object({ roundId: text, publishedAt: number, originalId: nullable(text) });
const original = object({
  id: text, roundId: text, author: profile, optionId: text, publishedAt: number,
  durationMs: (value) => check(Number.isFinite(value) && value > 0 && value <= 15_000),
  thumbnailAssetId: nullable(text),
  visibleReplyCount: (value) => check(Number.isInteger(value) && value >= 0),
});
const reply = object({
  id: text, originalId: text, roundId: text, author: profile, publishedAt: number,
  durationMs: (value) => check(Number.isFinite(value) && value > 0 && value <= 15_000),
  thumbnailAssetId: nullable(text),
});
const page = (item) => object({ items: list(item), nextCursor: nullable(text) });
const resultSchemas = {
  'rounds:today': { kind: 'query', validate: object({
    serverNow: number, round: nullable(round), viewerReceipt: nullable(receipt), canViewFriends: bool,
    ownOriginal: nullable(original), friendPresence: list(object({ profile, hasPublished: bool })),
  }) },
  'takes:feed': { kind: 'query', validate: page(original) },
  'takes:detail': { kind: 'query', validate: original },
  'replies:list': { kind: 'query', validate: page(reply) },
  'captions:get': { kind: 'query', validate: object({
    status: (value) => check(['unavailable', 'pending', 'ready', 'failed'].includes(value)),
    text: nullable(text),
  }) },
  'media:createPlaybackGrant': { kind: 'action', validate: object({ url: text, expiresAt: number }) },
};

function origin(value) {
  const url = new URL(value);
  check(url.protocol === 'https:' && !url.username && !url.password);
  check(url.pathname === '/' && !url.search && !url.hash);
  return url.origin;
}

export function validateManifest(value) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  const required = ['convexUrl', 'siteUrl', 'roundId', 'originalId', 'replyId'];
  check(Object.keys(value).length === required.length);
  for (const key of required) check(typeof value[key] === 'string' && value[key].length > 0);
  check(value.originalId !== value.replyId);
  return { ...value, convexUrl: origin(value.convexUrl), siteUrl: origin(value.siteUrl) };
}

export class ConvexProbe {
  constructor(manifest, tokens, fetcher = fetch) {
    this.manifest = validateManifest(manifest);
    this.tokens = tokens;
    this.fetcher = fetcher;
    for (const name of ['casey', 'dana', 'locked']) {
      check(typeof tokens[name] === 'string' && tokens[name].length > 0);
    }
    check(new Set(Object.values(tokens)).size === 3);
  }

  async call(kind, path, args, identity) {
    check(resultSchemas[path]?.kind === kind);
    check(typeof this.tokens[identity] === 'string');
    const response = await this.fetcher(`${this.manifest.convexUrl}/api/${kind}`, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens[identity]}` },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    const data = await response.json();
    check(data.logLines === undefined || (Array.isArray(data.logLines) && data.logLines.length === 0));
    if (response.ok && data.status === 'success') {
      keys(data, ['status', 'value', 'logLines']);
      resultSchemas[path].validate(data.value);
      return { ok: true, value: data.value };
    }
    if (data.status === 'error' && data.errorData) {
      keys(data, ['status', 'errorMessage', 'errorData', 'logLines']);
      keys(data.errorData, ['code', 'message', 'retryable']);
      check(typeof data.errorData.code === 'string' && typeof data.errorData.retryable === 'boolean');
      check(['Not found', 'Content unavailable', 'Unavailable'].includes(data.errorData.message));
      check(data.errorMessage === undefined || [
        data.errorData.message, JSON.stringify(data.errorData), `Uncaught ConvexError: ${JSON.stringify(data.errorData)}`,
      ].includes(data.errorMessage));
      return { ok: false, code: data.errorData.code };
    }
    throw new ProbeFailure();
  }

  async value(kind, path, args, identity) {
    const result = await this.call(kind, path, args, identity);
    check(result.ok);
    return result.value;
  }

  async denied(kind, path, args, identity) {
    const result = await this.call(kind, path, args, identity);
    check(!result.ok && result.code === 'NOT_FOUND');
  }

  async page(path, args, identity) {
    const items = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < 100; page++) {
      const value = await this.value('query', path, { ...args, cursor, limit: 100 }, identity);
      check(Array.isArray(value.items));
      check(value.nextCursor === null || typeof value.nextCursor === 'string');
      items.push(...value.items);
      if (value.nextCursor === null) return items;
      check(!seen.has(value.nextCursor));
      seen.add(value.nextCursor);
      cursor = value.nextCursor;
    }
    throw new ProbeFailure();
  }

  async grant(contentId, kind, identity) {
    const startedAt = Date.now();
    const value = await this.value('action', 'media:createPlaybackGrant', {
      contentId, kind, asset: 'video',
    }, identity);
    const url = new URL(value.url);
    check(url.origin === this.manifest.siteUrl && !url.username && !url.password && !url.hash);
    check(url.pathname.startsWith('/v1/media/') && url.searchParams.get('token'));
    check(Number.isFinite(value.expiresAt));
    check(value.expiresAt > Date.now() && value.expiresAt <= startedAt + 62_000);
    return value;
  }

  async media(grant) {
    const head = await this.fetcher(grant.url, {
      method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    check(head.status === 200);
    check(head.headers.get('content-type')?.split(';')[0] === 'video/mp4');
    const cache = head.headers.get('cache-control')?.toLowerCase().split(',').map((v) => v.trim());
    check(cache?.includes('private') && cache.includes('no-store'));
    const total = Number(head.headers.get('content-length'));
    check(Number.isInteger(total) && total > 0 && total <= 20 * 1024 * 1024);
    const range = await this.fetcher(grant.url, {
      headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    check(range.status === 206 && range.headers.get('content-range') === `bytes 0-0/${total}`);
    check(range.headers.get('content-length') === '1');
    const rangeCache = range.headers.get('cache-control')?.toLowerCase().split(',').map((v) => v.trim());
    check(rangeCache?.includes('private') && rangeCache.includes('no-store'));
    check((await range.arrayBuffer()).byteLength === 1);
    const corrupted = new URL(grant.url);
    corrupted.searchParams.set('token', 'invalid-probe-token');
    const denial = await this.fetcher(corrupted.href, {
      headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    check([403, 404].includes(denial.status));
    check(!denial.headers.get('content-type')?.startsWith('video/'));
    check(['', 'Not found', 'Content unavailable', 'Unavailable'].includes(await denial.text()));
  }
}

function currentRound(value, roundId) {
  round(value);
  check(value.id === roundId && value.isCurrent === true && value.options.length > 0);
}

export function lockedToday(value, roundId) {
  resultSchemas['rounds:today'].validate(value);
  check(value.viewerReceipt === null);
  currentRound(value.round, roundId);
  check(value.canViewFriends === false && value.ownOriginal === null);
}

export async function runProbe(probe, report = () => {}) {
  const { roundId, originalId, replyId } = probe.manifest;
  const results = [];
  const step = async (id, action) => {
    try {
      await action();
      results.push({ id, passed: true });
    } catch {
      results.push({ id, passed: false });
    }
    report(results.at(-1));
  };
  for (const identity of ['casey', 'dana']) {
    const count = identity === 'casey' ? 1 : 0;
    await step(`${identity}.same-round-receipt`, async () => {
      const today = await probe.value('query', 'rounds:today', {}, identity);
      currentRound(today.round, roundId);
      check(today.viewerReceipt?.roundId === roundId);
      check(today.canViewFriends === true);
    });
    await step(`${identity}.original-only-feed`, async () => {
      const feed = await probe.page('takes:feed', { roundId }, identity);
      check(new Set(feed.map((item) => item.id)).size === feed.length);
      check(feed.every((item) => item.id !== replyId && !('originalId' in item) && item.roundId === roundId));
      check(feed.some((item) => item.id === originalId && item.visibleReplyCount === count));
    });
    await step(`${identity}.detail-visible-count`, async () => {
      const detail = await probe.value('query', 'takes:detail', { originalId }, identity);
      check(detail.id === originalId && detail.visibleReplyCount === count);
    });
    await step(`${identity}.filtered-flat-replies`, async () => {
      const replies = await probe.page('replies:list', { originalId }, identity);
      check(replies.length === count);
      check(replies.every((item) => item.id === replyId && item.originalId === originalId && item.roundId === roundId));
    });
    await step(`${identity}.original-video`, async () => {
      await probe.media(await probe.grant(originalId, 'original', identity));
    });
  }
  await step('casey.reply-direct-caption', async () => {
    const caption = await probe.value('query', 'captions:get', { contentId: replyId, kind: 'reply' }, 'casey');
    check(['unavailable', 'pending', 'ready', 'failed'].includes(caption.status));
    check(caption.status === 'ready' ? typeof caption.text === 'string' : caption.text === null);
  });
  await step('casey.reply-direct-video', async () => {
    await probe.media(await probe.grant(replyId, 'reply', 'casey'));
  });
  for (const asset of ['video', 'thumbnail']) {
    await step(`dana.reply-${asset}-denied`, () => probe.denied('action', 'media:createPlaybackGrant', {
      contentId: replyId, kind: 'reply', asset,
    }, 'dana'));
  }
  await step('dana.reply-caption-denied', () => probe.denied('query', 'captions:get', {
    contentId: replyId, kind: 'reply',
  }, 'dana'));
  await step('locked.safe-today', async () => {
    lockedToday(await probe.value('query', 'rounds:today', {}, 'locked'), roundId);
  });
  await step('locked.no-feed', async () => {
    const result = await probe.call('query', 'takes:feed', { roundId, cursor: null, limit: 100 }, 'locked');
    check(result.ok ? Array.isArray(result.value?.items) && result.value.items.length === 0 && result.value.nextCursor === null : result.code === 'NOT_FOUND');
  });
  await step('locked.original-direct-denied', () => probe.denied('query', 'takes:detail', { originalId }, 'locked'));
  await step('locked.reply-list-denied', () => probe.denied('query', 'replies:list', {
    originalId, cursor: null, limit: 100,
  }, 'locked'));
  for (const [kind, contentId] of [['original', originalId], ['reply', replyId]]) {
    for (const asset of ['video', 'thumbnail']) {
      await step(`locked.${kind}-${asset}-denied`, () => probe.denied('action', 'media:createPlaybackGrant', {
        contentId, kind, asset,
      }, 'locked'));
    }
    await step(`locked.${kind}-caption-denied`, () => probe.denied('query', 'captions:get', { contentId, kind }, 'locked'));
  }
  return results;
}

async function main() {
  try {
    check(process.argv.length === 3);
    const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const probe = new ConvexProbe(manifest, {
      casey: process.env.TAKE_CASEY_ID_TOKEN,
      dana: process.env.TAKE_DANA_ID_TOKEN,
      locked: process.env.TAKE_LOCKED_ID_TOKEN,
    });
    const results = await runProbe(probe, ({ id, passed }) => console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`));
    console.log(`${results.filter((row) => row.passed).length}/${results.length} deployed assertions passed`);
    process.exitCode = results.every((row) => row.passed) ? 0 : 1;
  } catch {
    console.error('Probe setup/transport failed. Check the manifest and secure token environment; no response data was logged.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
