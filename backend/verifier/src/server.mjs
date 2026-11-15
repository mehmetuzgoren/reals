import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, VerificationError } from './config.mjs';
import { checkExecutables } from './process.mjs';
import { verifyBytes } from './media.mjs';

function reply(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', Connection: 'close', ...(status === 429 ? { 'Retry-After': '1' } : {}) });
  res.end(body);
}

function readBody(req, maximum, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    const hash = createHash('sha256');
    const finish = (error) => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', failed);
      signal.removeEventListener('abort', aborted);
      if (error) {
        req.pause();
        chunks.length = 0;
        reject(error);
      } else {
        resolve({ bytes: Buffer.concat(chunks, length), sha256: hash.digest('hex') });
      }
    };
    const data = (chunk) => {
      length += chunk.length;
      if (length > maximum) {
        finish(new VerificationError(413, 'PAYLOAD_TOO_LARGE', 'The upload exceeds the byte limit.'));
        return;
      }
      hash.update(chunk);
      chunks.push(chunk);
    };
    const end = () => finish();
    const failed = () => finish(new VerificationError(400, 'INVALID_REQUEST', 'The upload was incomplete.'));
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new VerificationError(408, 'REQUEST_TIMEOUT', 'The upload timed out.')), timeoutMs);
    timer.unref();
    req.on('data', data);
    req.once('end', end);
    req.once('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export async function createVerifierServer(config = loadConfig()) {
  await checkExecutables();
  const expectedAuthorization = createHash('sha256').update(`Bearer ${config.secret}`).digest();
  let active = 0;
  const handler = async (req, res) => {
    req.on('error', () => {});
    const controller = new AbortController();
    const timedOut = () => controller.abort(new VerificationError(408, 'REQUEST_TIMEOUT', 'The request timed out.'));
    const disconnected = () => {
      if (!res.writableFinished) controller.abort(new VerificationError(400, 'INVALID_REQUEST', 'The request was disconnected.'));
    };
    const timer = setTimeout(timedOut, config.requestTimeoutMs);
    timer.unref();
    req.on('aborted', disconnected);
    res.on('close', disconnected);
    res.once('finish', () => { if (!req.complete) req.destroy(); });
    let claimed = false;
    try {
      const counts = new Map();
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const name = req.rawHeaders[index].toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const authorization = req.headers.authorization ?? '';
      const actualAuthorization = createHash('sha256').update(authorization).digest();
      if (counts.get('authorization') !== 1 || !timingSafeEqual(expectedAuthorization, actualAuthorization)) {
        throw new VerificationError(401, 'UNAUTHORIZED', 'Authentication is required.');
      }
      if (req.url === '/health' && req.method === 'GET') {
        reply(res, 200, { ok: true });
        return;
      }
      if (req.method !== 'POST' || !['/verify', '/verify-avatar'].includes(req.url)) {
        throw new VerificationError(404, 'NOT_FOUND', 'The endpoint was not found.');
      }
      if (counts.get('content-type') !== 1 || req.headers['content-type'].toLowerCase() !== 'application/octet-stream' || req.headers['content-encoding'] !== undefined) {
        throw new VerificationError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send unencoded application/octet-stream bytes.');
      }
      if (req.headers.expect !== undefined) throw new VerificationError(417, 'INVALID_REQUEST', 'Expect headers are not supported.');
      const expectedHash = req.headers['x-content-sha256'];
      if (counts.get('x-content-sha256') !== 1 || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
        throw new VerificationError(400, 'INVALID_HASH', 'X-Content-SHA256 must be the lowercase SHA-256 of the exact body.');
      }
      const kind = req.url === '/verify' ? 'video' : 'avatar';
      const maximum = kind === 'video' ? config.maxBytes : config.maxAvatarBytes;
      const contentLength = req.headers['content-length'];
      if (contentLength !== undefined && Number(contentLength) > maximum) throw new VerificationError(413, 'PAYLOAD_TOO_LARGE', 'The upload exceeds the byte limit.');
      if (active >= config.concurrency) throw new VerificationError(429, 'BUSY', 'The verifier is at capacity. Retry later.');
      active++;
      claimed = true;
      const { bytes, sha256 } = await readBody(req, maximum, config.bodyTimeoutMs, controller.signal);
      if (!timingSafeEqual(Buffer.from(sha256, 'hex'), Buffer.from(expectedHash, 'hex'))) {
        throw new VerificationError(400, 'HASH_MISMATCH', 'The body does not match X-Content-SHA256.');
      }
      const verified = await verifyBytes(bytes, kind, config, controller.signal);
      controller.signal.throwIfAborted();
      reply(res, 200, { sha256, ...verified });
    } catch (error) {
      const failure = controller.signal.aborted ? controller.signal.reason : error;
      if (failure instanceof VerificationError) reply(res, failure.status, { error: { code: failure.code, message: failure.message } });
      else reply(res, 503, { error: { code: 'VERIFIER_UNAVAILABLE', message: 'Media verification is unavailable.' } });
    } finally {
      clearTimeout(timer);
      req.off('aborted', disconnected);
      res.off('close', disconnected);
      if (claimed) active--;
    }
  };
  const server = createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 500 }, handler);
  server.on('checkContinue', handler);
  server.on('checkExpectation', handler);
  server.maxConnections = config.maxConnections;
  server.dropMaxConnection = true;
  server.maxHeadersCount = 32;
  server.headersTimeout = Math.min(5000, config.requestTimeoutMs);
  server.requestTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 1;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    const server = await createVerifierServer(config);
    server.listen(config.port, '0.0.0.0', () => console.log('Media verifier listening.'));
    server.on('error', () => { console.error('Media verifier could not listen.'); process.exitCode = 1; });
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => {
      server.close();
      server.closeIdleConnections();
      const timer = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, config.requestTimeoutMs + 1000);
      timer.unref();
    });
  } catch {
    console.error('Media verifier startup failed. Check its server-only configuration and installed ffmpeg/ffprobe.');
    process.exitCode = 1;
  }
}
