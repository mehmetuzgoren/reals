import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, HARD_LIMITS } from '../src/config.mjs';
import { createVerifierServer } from '../src/server.mjs';
import { inspectMp4 } from '../src/mp4.mjs';
import { fixtures } from './fixtures.mjs';

const secret = 'test-only-service-secret-000000000000000000000';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let media;
let directory;
let primary;

async function serve(overrides = {}) {
  const config = { ...loadConfig({ VERIFY_SHARED_SECRET: secret }), tempRoot: directory, ...overrides };
  const server = await createVerifierServer(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function close(service) {
  const closed = once(service.server, 'close');
  service.server.close();
  service.server.closeAllConnections();
  await closed;
}

async function verify(bytes, { path = '/verify', service = primary, headers = {} } = {}) {
  const response = await fetch(service.url + path, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': hash(bytes), ...headers }, body: bytes, signal: AbortSignal.timeout(10_000) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function raw(service, { headers, path = '/verify', end = true, bytes = Buffer.alloc(0) }) {
  let outgoing;
  const response = new Promise((resolve, reject) => {
    outgoing = request(service.url + path, { method: 'POST', headers }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('Test request timed out.')));
    outgoing.flushHeaders();
    if (end) outgoing.end(bytes);
    else if (bytes.length) outgoing.write(bytes);
  });
  return { outgoing, response };
}

function headersFor(bytes) {
  return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': hash(bytes) };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'take-verifier-service-test-'));
  media = await fixtures();
  primary = await serve();
}, { timeout: 60_000 });

after(async () => {
  if (primary) await close(primary);
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('real portrait H264/AAC bytes produce an exact body-bound result and decoded JPEG', async () => {
  const bytes = media['valid.mp4'];
  const result = await verify(bytes);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body).sort(), ['sha256', 'durationMs', 'width', 'height', 'videoCodec', 'audioCodec', 'thumbnailBase64'].sort());
  assert.equal(result.body.sha256, hash(bytes));
  assert.equal(result.body.durationMs, 3000);
  assert.equal(result.body.width, 96);
  assert.equal(result.body.height, 160);
  assert.equal(result.body.videoCodec, 'h264');
  assert.equal(result.body.audioCodec, 'aac');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.ok(result.body.thumbnailBase64);
  const thumbnail = Buffer.from(result.body.thumbnailBase64, 'base64');
  assert.equal(thumbnail.readUInt16BE(0), 0xffd8);
  assert.ok(thumbnail.length <= HARD_LIMITS.imageOutputBytes);
  assert.deepEqual(await readdir(directory), []);
});

test('display rotation is applied: coded landscape rotated to portrait is valid', async () => {
  const result = await verify(media['rotated.mp4']);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.width, 96);
  assert.equal(result.body.height, 160);
});

test('native-profile 30 FPS, 600-tick H264 with stereo AAC fully verifies', async () => {
  const result = await verify(media['native-stereo.mp4']);
  assert.equal(result.status, 200, JSON.stringify(result.body.error));
  assert.equal(result.body.durationMs, 3000);
  assert.equal(result.body.width, 180);
  assert.equal(result.body.height, 320);
});

test('exactly 15000ms is accepted, without a grace period beyond the video cap', async () => {
  const result = await verify(media['at-limit.mp4']);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.durationMs, 15_000);
});

test('exactly 15000ms at the native 600 tick timescale does not round to 15001ms', async () => {
  const result = await verify(media['at-limit-600.mp4']);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.durationMs, 15_000);
});

for (const name of ['valid.mp4', 'at-minimum-600.mp4']) {
  test(`exactly 3000ms is accepted at the minimum: ${name}`, async () => {
    const result = await verify(media[name]);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.durationMs, 3000);
    assert.equal(result.body.sha256, hash(media[name]));
    assert.deepEqual(await readdir(directory), []);
  });
}

test('a three-second sample duration with a positive start offset remains valid', async () => {
  const timing = inspectMp4(media['at-minimum-offset.mp4'], HARD_LIMITS.durationMs);
  assert.equal(timing.durations.reduce((ticks, duration) => ticks + BigInt(duration), 0n), 3n * BigInt(timing.timeScale));
  const result = await verify(media['at-minimum-offset.mp4']);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.durationMs, 3001);
  assert.deepEqual(await readdir(directory), []);
});

for (const [name, durationMicroseconds] of [['one-second.mp4', 1_000_000], ['below-minimum.mp4', 2_999_000], ['below-minimum-submillisecond.mp4', 2_999_990], ['below-minimum-offset.mp4', 2_999_990]]) {
  test(`rejects video below the 3000ms minimum without a grace period: ${name}`, async () => {
    const timing = inspectMp4(media[name], HARD_LIMITS.durationMs);
    assert.equal(timing.durations.reduce((ticks, duration) => ticks + BigInt(duration), 0n) * 1_000_000n, BigInt(durationMicroseconds) * BigInt(timing.timeScale));
    const result = await verify(media[name]);
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, 'INVALID_MEDIA');
    assert.deepEqual(await readdir(directory), []);
  });
}

for (const name of ['landscape.mp4', 'rotated-landscape.mp4', 'scaled-matrix.mp4', 'silent.mp4', 'no-audio.mp4', 'wrong-video.mp4', 'wrong-audio.mp4', 'over-limit.mp4', 'fast.mp4', 'truncated.mp4', 'corrupt.mp4', 'corrupt-tail.mp4', 'fake-duration.mp4', 'fake-final-sample.mp4', 'fake-edit-duration.mp4']) {
  test(`rejects actual invalid video fixture: ${name}`, async () => {
    const result = await verify(media[name]);
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, 'INVALID_MEDIA');
    assert.deepEqual(await readdir(directory), []);
  });
}

test('arbitrary text, fake MP4 headers, zero-byte uploads, and paths/URLs are not media', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('https://example.com/video.mp4'), Buffer.from('/etc/passwd'), Buffer.from('{"durationMs":1000,"width":96,"height":160}'), Buffer.from('0000ftypisom0000moov0000mdat')]) {
    const result = await verify(bytes);
    assert.equal(result.status, 422, JSON.stringify(result.body));
  }
});

test('both endpoints and health require the exact server-only bearer secret', async () => {
  for (const path of ['/verify', '/verify-avatar', '/health']) {
    for (const authorization of ['', 'Bearer short', `Bearer ${secret}x`, secret, `bearer ${secret}`]) {
      const response = await fetch(primary.url + path, { method: path === '/health' ? 'GET' : 'POST', headers: { Authorization: authorization }, body: path === '/health' ? undefined : media['valid.mp4'] });
      assert.equal(response.status, 401);
      const body = await response.text();
      assert.ok(!body.includes(secret));
    }
  }
  const health = await fetch(primary.url + '/health', { headers: { Authorization: `Bearer ${secret}` } });
  assert.deepEqual(await health.json(), { ok: true });
});

test('wrong/missing/malformed/duplicate hashes and duplicate authorization fail closed', async () => {
  for (const value of ['0'.repeat(64), '', 'abcd', 'A'.repeat(64)]) {
    const result = await verify(media['valid.mp4'], { headers: { 'X-Content-SHA256': value } });
    assert.equal(result.status, 400);
  }
  const missing = headersFor(media['valid.mp4']);
  delete missing['X-Content-SHA256'];
  assert.equal((await raw(primary, { headers: missing, bytes: media['valid.mp4'] }).response).status, 400);
  const duplicateHash = headersFor(media['valid.mp4']);
  duplicateHash['X-Content-SHA256'] = [hash(media['valid.mp4']), hash(media['valid.mp4'])];
  assert.equal((await raw(primary, { headers: duplicateHash, bytes: media['valid.mp4'] }).response).status, 400);
  const duplicateAuth = headersFor(media['valid.mp4']);
  duplicateAuth.Authorization = [`Bearer ${secret}`, `Bearer ${secret}`];
  assert.equal((await raw(primary, { headers: duplicateAuth, bytes: media['valid.mp4'] }).response).status, 401);
});

test('only exact routes, binary content type and unencoded bytes are accepted', async () => {
  for (const path of ['/verify?url=https://example.com', '/verify/../../etc/passwd', '/arbitrary']) {
    assert.equal((await verify(media['valid.mp4'], { path })).status, 404);
  }
  for (const headers of [{ 'Content-Type': 'video/mp4' }, { 'Content-Type': 'application/json' }, { 'Content-Encoding': 'gzip' }]) {
    assert.equal((await verify(media['valid.mp4'], { headers })).status, 415);
  }
  const expected = { ...headersFor(media['valid.mp4']), Expect: '100-continue' };
  assert.equal((await raw(primary, { headers: expected, bytes: media['valid.mp4'] }).response).status, 417);
});

test('advertised bodies above the actual 20MiB and 2MiB caps are rejected before reading', async () => {
  for (const [path, limit] of [['/verify', HARD_LIMITS.videoBytes], ['/verify-avatar', HARD_LIMITS.avatarBytes]]) {
    const result = await raw(primary, { path, headers: { ...headersFor(Buffer.alloc(0)), 'Content-Length': limit + 1 }, end: false }).response;
    assert.equal(result.status, 413);
  }
});

test('chunked uploads enforce the byte cap while reading actual bytes', async () => {
  const service = await serve({ maxBytes: 1024, maxAvatarBytes: 1024 });
  try {
    for (const path of ['/verify', '/verify-avatar']) {
      const bytes = Buffer.alloc(2048);
      const result = await raw(service, { path, headers: headersFor(bytes), bytes }).response;
      assert.equal(result.status, 413);
    }
  } finally { await close(service); }
});

test('actual chunked input beyond 20MiB video and 2MiB avatar hard caps is rejected', async () => {
  for (const [path, limit] of [['/verify', HARD_LIMITS.videoBytes], ['/verify-avatar', HARD_LIMITS.avatarBytes]]) {
    const bytes = Buffer.alloc(limit + 1);
    const result = await raw(primary, { path, headers: headersFor(bytes), bytes }).response;
    assert.equal(result.status, 413);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('a slow body hits its absolute receive deadline and capacity is released', async () => {
  const service = await serve({ bodyTimeoutMs: 60, requestTimeoutMs: 1000, concurrency: 1 });
  try {
    const result = await raw(service, { headers: { ...headersFor(media['valid.mp4']), 'Content-Length': media['valid.mp4'].length }, bytes: media['valid.mp4'].subarray(0, 1), end: false }).response;
    assert.equal(result.status, 408);
    assert.equal((await verify(media['valid.mp4'], { service })).status, 200);
  } finally { await close(service); }
});

test('the full request deadline also bounds verification after receiving bytes', async () => {
  const service = await serve({ bodyTimeoutMs: 80, requestTimeoutMs: 100, processTimeoutMs: 1000 });
  try {
    const pending = raw(service, { headers: { ...headersFor(media['valid.mp4']), 'Content-Length': media['valid.mp4'].length }, end: false });
    await delay(75);
    pending.outgoing.end(media['valid.mp4']);
    const result = await pending.response;
    assert.equal(result.status, 408);
    assert.deepEqual(await readdir(directory), []);
  } finally { await close(service); }
});

test('real ffprobe/ffmpeg work times out without accepting metadata', async () => {
  const service = await serve({ processTimeoutMs: 1 });
  try {
    const result = await verify(media['valid.mp4'], { service });
    assert.equal(result.status, 504);
    assert.equal(result.body.error.code, 'VERIFICATION_TIMEOUT');
    assert.deepEqual(await readdir(directory), []);
  } finally { await close(service); }
});

test('concurrency includes uploads, has no waiting queue, and rejects excess work', async () => {
  const service = await serve({ concurrency: 1 });
  try {
    const pending = raw(service, { headers: { ...headersFor(media['valid.mp4']), 'Content-Length': media['valid.mp4'].length }, bytes: media['valid.mp4'].subarray(0, 1), end: false });
    await delay(30);
    const busy = await verify(media['valid.mp4'], { service });
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get('retry-after'), '1');
    pending.outgoing.end(media['valid.mp4'].subarray(1));
    assert.equal((await pending.response).status, 200);
    assert.equal((await verify(media['valid.mp4'], { service })).status, 200);
  } finally { await close(service); }
});

test('client disconnection releases capacity and cleans private temporary files', async () => {
  const service = await serve({ concurrency: 1 });
  try {
    const pending = raw(service, { headers: { ...headersFor(media['valid.mp4']), 'Content-Length': media['valid.mp4'].length }, bytes: media['valid.mp4'].subarray(0, 1), end: false });
    pending.response.catch(() => {});
    await delay(30);
    pending.outgoing.destroy();
    await delay(60);
    assert.equal((await verify(media['valid.mp4'], { service })).status, 200);
    assert.deepEqual(await readdir(directory), []);
  } finally { await close(service); }
});

test('disconnecting after sending bytes aborts in-flight inspection and frees its slot', async () => {
  const service = await serve({ concurrency: 1 });
  try {
    const pending = raw(service, { headers: { ...headersFor(media['at-limit.mp4']), 'Content-Length': media['at-limit.mp4'].length }, bytes: media['at-limit.mp4'] });
    pending.response.catch(() => {});
    await delay(20);
    pending.outgoing.destroy();
    await delay(80);
    assert.equal((await verify(media['valid.mp4'], { service })).status, 200);
    assert.deepEqual(await readdir(directory), []);
  } finally { await close(service); }
});

for (const name of ['avatar.jpg', 'avatar.png', 'metadata.jpg', 'at-dimension-limit.png', 'interlaced.png']) {
  test(`fully decodes and normalizes ${name} to a small metadata-free JPEG`, async () => {
    const result = await verify(media[name], { path: '/verify-avatar' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(Object.keys(result.body).sort(), ['sha256', 'width', 'height', 'mimeType', 'imageBase64'].sort());
    assert.equal(result.body.sha256, hash(media[name]));
    assert.equal(result.body.mimeType, 'image/jpeg');
    assert.ok(result.body.width > 0 && result.body.width <= 512);
    assert.ok(result.body.height > 0 && result.body.height <= 512);
    const jpeg = Buffer.from(result.body.imageBase64, 'base64');
    assert.ok(jpeg.length <= HARD_LIMITS.imageOutputBytes);
    assert.equal(jpeg.readUInt16BE(0), 0xffd8);
    assert.ok(!jpeg.includes(Buffer.from('private-avatar-metadata')));
    assert.ok(!jpeg.includes(Buffer.from('Lavc')));
    const roundTrip = await verify(jpeg, { path: '/verify-avatar' });
    assert.equal(roundTrip.status, 200, JSON.stringify(roundTrip.body));
    assert.equal(roundTrip.body.width, result.body.width);
    assert.equal(roundTrip.body.height, result.body.height);
    assert.deepEqual(await readdir(directory), []);
  });
}

for (const name of ['avatar.gif', 'animated.png', 'large.png', 'large.jpg', 'corrupt.png', 'truncated-idat.png', 'short-raster.png', 'extra-raster.png', 'extra-zlib.png', 'unknown-critical.png', 'separated-idat.png', 'invalid-filter.png', 'corrupt.jpg', 'truncated-entropy.jpg', 'concatenated.jpg', 'valid.mp4']) {
  test(`rejects invalid avatar fixture: ${name}`, async () => {
    const result = await verify(media[name], { path: '/verify-avatar' });
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.deepEqual(await readdir(directory), []);
  });
}
