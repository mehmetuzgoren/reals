import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInflate } from 'node:zlib';
import { HARD_LIMITS, invalidMedia } from './config.mjs';
import { runProcess } from './process.mjs';
import { inspectMp4 } from './mp4.mjs';

const inputOptions = ['-max_alloc', '67108864', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-probesize', String(HARD_LIMITS.videoBytes), '-analyzeduration', '16000000'];
const decodeOptions = ['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'repeat+level+info', '-xerror', '-err_detect', 'explode', '-filter_threads', '1', '-filter_complex_threads', '1'];

function positive(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > maximum) throw invalidMedia();
  return number;
}

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = positive(value, maximum);
  if (!Number.isSafeInteger(number)) throw invalidMedia();
  return number;
}

function fraction(value, maximum) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) throw invalidMedia();
  const numerator = integer(match[1], 1_000_000_000);
  const denominator = integer(match[2], 1_000_000_000);
  return { numerator, denominator, value: positive(numerator / denominator, maximum) };
}

function millisecondsFromTicks(ticks, timeBase) {
  const numerator = BigInt(ticks) * BigInt(timeBase.numerator) * 1000n;
  const denominator = BigInt(timeBase.denominator);
  return Number((numerator + denominator - 1n) / denominator);
}

function dimensions(width, height, maxPixels, maxDimension = HARD_LIMITS.dimension) {
  integer(width, maxDimension);
  integer(height, maxDimension);
  if (width * height > maxPixels) throw invalidMedia();
}

async function validatePngRaster(compressed, width, height, depth, channels, interlaced, signal) {
  const passes = [];
  for (const [x, y, dx, dy] of interlaced ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]) {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    if (columns && rows) passes.push({ rows, rowBytes: 1 + Math.ceil(columns * channels * depth / 8) });
  }
  const expected = passes.reduce((total, pass) => total + pass.rows * pass.rowBytes, 0);
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const inflater = createInflate({ chunkSize: 16 * 1024 });
    let settled = false;
    let total = 0;
    let pass = 0;
    let row = 0;
    let column = 0;
    const aborted = () => finish(signal.reason);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      inflater.destroy();
      if (error) reject(error);
      else resolve();
    };
    inflater.on('data', (chunk) => {
      total += chunk.length;
      if (total > expected) return finish(invalidMedia());
      let offset = 0;
      while (offset < chunk.length) {
        if (!passes[pass] || (column === 0 && chunk[offset] > 4)) return finish(invalidMedia());
        const amount = Math.min(chunk.length - offset, passes[pass].rowBytes - column);
        offset += amount;
        column += amount;
        if (column === passes[pass].rowBytes) {
          column = 0;
          if (++row === passes[pass].rows) {
            pass++;
            row = 0;
          }
        }
      }
    });
    inflater.on('error', () => finish(signal.aborted ? signal.reason : invalidMedia()));
    inflater.on('end', () => finish(total === expected && inflater.bytesWritten === compressed.length ? undefined : invalidMedia()));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else inflater.end(compressed);
  });
}

async function avatarFormat(bytes, signal) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let scanning = false;
    let sawImage = false;
    let sawScan = false;
    let markers = 0;
    while (offset < bytes.length) {
      if (scanning) {
        while (offset < bytes.length) {
          if (bytes[offset++] !== 0xff) continue;
          const start = offset - 1;
          while (bytes[offset] === 0xff) offset++;
          const marker = bytes[offset++];
          if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) continue;
          offset = start;
          scanning = false;
          break;
        }
      }
      if (++markers > 4096 || bytes[offset++] !== 0xff) throw invalidMedia();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (!sawImage || !sawScan || offset !== bytes.length) throw invalidMedia();
        return 'jpeg';
      }
      if ([0, 1, 0xd8].includes(marker) || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) throw invalidMedia();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || length > bytes.length - offset) throw invalidMedia();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (sawImage || length < 8 || bytes[offset + 2] !== 8) throw invalidMedia();
        dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3), HARD_LIMITS.avatarPixels, HARD_LIMITS.avatarDimension);
        sawImage = true;
      }
      if (marker === 0xda) {
        if (!sawImage) throw invalidMedia();
        scanning = true;
        sawScan = true;
      }
      offset += length;
    }
    throw invalidMedia();
  }
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw invalidMedia();
  let offset = 8;
  let chunks = 0;
  let sawEnd = false;
  let width;
  let height;
  let depth;
  let color;
  let interlaced;
  let paletteEntries = 0;
  let sawTransparency = false;
  let sawData = false;
  let dataEnded = false;
  const data = [];
  while (offset < bytes.length) {
    if (++chunks > 4096 || bytes.length - offset < 12) throw invalidMedia();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalidMedia();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || /[a-z]/.test(type[2])) throw invalidMedia();
    if (chunks === 1) {
      if (type !== 'IHDR' || length !== 13) throw invalidMedia();
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      dimensions(width, height, HARD_LIMITS.avatarPixels, HARD_LIMITS.avatarDimension);
      depth = bytes[offset + 16];
      color = bytes[offset + 17];
      interlaced = bytes[offset + 20];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || interlaced > 1) throw invalidMedia();
    } else if (type === 'IHDR') throw invalidMedia();
    if (type === 'PLTE') {
      if (sawData || sawTransparency || paletteEntries || [0, 4].includes(color) || length < 3 || length > 768 || length % 3 !== 0) throw invalidMedia();
      paletteEntries = length / 3;
      if (color === 3 && paletteEntries > 2 ** depth) throw invalidMedia();
    }
    if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !paletteEntries)) throw invalidMedia();
      sawData = true;
      data.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (sawData) dataEnded = true;
    if (type === 'tRNS') {
      if (sawData || sawTransparency || !((color === 0 && length === 2) || (color === 2 && length === 6) || (color === 3 && paletteEntries && length > 0 && length <= paletteEntries))) throw invalidMedia();
      sawTransparency = true;
    }
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalidMedia();
    if ((type.charCodeAt(0) & 32) === 0 && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) throw invalidMedia();
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) throw invalidMedia();
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length || !sawData) throw invalidMedia();
      sawEnd = true;
    }
  }
  if (!sawEnd) throw invalidMedia();
  await validatePngRaster(Buffer.concat(data), width, height, depth, { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color], interlaced, signal);
  return 'png';
}

async function probe(path, video, config, signal) {
  const result = await runProcess('/usr/bin/ffprobe', [
    '-v', 'error', ...inputOptions,
    ...(video ? ['-format_whitelist', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0'] : ['-f', 'image2']),
    ...(video ? ['-fflags', '+noparse', '-show_packets'] : []),
    '-show_entries', 'packet=stream_index,pts,dts:format=format_name,duration,start_time:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate,time_base,duration,duration_ts,start_time,nb_frames,sample_rate,channels:stream_disposition=attached_pic:stream_side_data=rotation,displaymatrix,side_data_type:stream_tags=rotate',
    '-of', 'json=compact=1', path,
  ], { signal, timeoutMs: config.processTimeoutMs, maxOutputBytes: (video ? 512 : 128) * 1024 });
  if (result.stderr.trim()) throw invalidMedia();
  try {
    return JSON.parse(result.stdout.toString('utf8'));
  } catch {
    throw invalidMedia();
  }
}

function videoMetadata(metadata, container, config) {
  const streams = metadata.streams;
  if (!Array.isArray(streams) || streams.length !== 2) throw invalidMedia();
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video || !audio || video.codec_name !== 'h264' || audio.codec_name !== 'aac' || audio.profile !== 'LC') throw invalidMedia();
  if (!['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(video.profile) || !['yuv420p', 'yuvj420p'].includes(video.pix_fmt)) throw invalidMedia();
  if (video.disposition?.attached_pic || !['1:1', undefined].includes(video.sample_aspect_ratio)) throw invalidMedia();
  dimensions(video.width, video.height, HARD_LIMITS.videoPixels);
  const matrices = (video.side_data_list ?? []).filter((item) => item.side_data_type === 'Display Matrix');
  if (matrices.length > 1) throw invalidMedia();
  for (const item of matrices) {
    if (typeof item.displaymatrix !== 'string') throw invalidMedia();
    const values = item.displaymatrix.trim().split('\n').flatMap((line) => line.slice(line.indexOf(':') + 1).trim().split(/\s+/).map(Number));
    if (values.length !== 9 || !values.every(Number.isSafeInteger)) throw invalidMedia();
    const [a, b, u, c, d, v, , , w] = values;
    if (![a, b, c, d].every((value) => [0, 65536, -65536].includes(value)) || Math.abs(a) + Math.abs(b) !== 65536 || Math.abs(c) + Math.abs(d) !== 65536 || a * c + b * d !== 0 || u !== 0 || v !== 0 || w !== 1073741824) throw invalidMedia();
  }
  const rotations = (video.side_data_list ?? []).filter((item) => item.rotation !== undefined).map((item) => Number(item.rotation));
  if (video.tags?.rotate !== undefined) rotations.push(Number(video.tags.rotate));
  if (rotations.some((rotation) => !Number.isFinite(rotation) || rotation % 90 !== 0)) throw invalidMedia();
  const rotation = rotations[0] ?? 0;
  if (rotations.some((other) => ((other - rotation) % 360) !== 0)) throw invalidMedia();
  const swapped = Math.abs(rotation % 180) === 90;
  const width = swapped ? video.height : video.width;
  const height = swapped ? video.width : video.height;
  if (width >= height) throw invalidMedia();
  const fps = fraction(video.avg_frame_rate, HARD_LIMITS.fps).value;
  fraction(video.r_frame_rate, HARD_LIMITS.fps);
  const timeBase = fraction(video.time_base, 1);
  if (BigInt(timeBase.numerator) * BigInt(container.timeScale) !== BigInt(timeBase.denominator)) throw invalidMedia();
  const frameCount = integer(video.nb_frames, Math.ceil(HARD_LIMITS.fps * config.maxDurationMs / 1000));
  if (!Array.isArray(metadata.packets) || metadata.packets.length > 4096) throw invalidMedia();
  const packets = metadata.packets.filter((packet) => packet.stream_index === video.index).map((packet, index) => ({ ...packet, duration: container.durations[index] }));
  if (packets.length !== frameCount || packets.length !== container.durations.length) throw invalidMedia();
  let dts = packets[0].dts;
  for (const packet of packets) {
    if (!Number.isSafeInteger(packet.pts) || packet.pts < 0 || !Number.isSafeInteger(packet.dts) || packet.dts !== dts || !Number.isSafeInteger(packet.pts + packet.duration)) throw invalidMedia();
    dts += packet.duration;
  }
  packets.sort((a, b) => a.pts - b.pts);
  const maxSeconds = config.maxDurationMs / 1000;
  const duration = Math.max(...[metadata.format, video, audio].map((item) => positive(item?.duration, maxSeconds)));
  for (const stream of streams) {
    const start = Number(stream.start_time);
    if (!Number.isFinite(start) || start < 0 || start > 0.1) throw invalidMedia();
  }
  const durationTicks = integer(video.duration_ts);
  const trackDuration = durationTicks * timeBase.numerator / timeBase.denominator;
  if (millisecondsFromTicks(durationTicks, timeBase) > config.maxDurationMs || Math.abs(trackDuration - Number(video.duration)) > 0.001) throw invalidMedia();
  const sampleRate = integer(audio.sample_rate, 96_000);
  if (sampleRate < 8000 || integer(audio.channels, 2) < 1) throw invalidMedia();
  return { video, audio, width, height, fps, timeBase, frameCount, duration, sampleRate, packets };
}

function decodedFrames(stderr) {
  if (/\[(?:warning|error|fatal|panic)\]/i.test(stderr)) throw invalidMedia();
  const frames = [];
  for (const line of stderr.split('\n')) {
    if (!line.includes('Parsed_showinfo_') || !/\bn:\s*\d/.test(line)) continue;
    const frame = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\S+\s+duration:\s*(\d+)\s+duration_time:\S+\s+fmt:(\S+).*?\bsar:(\d+)\/(\d+)\s+s:(\d+)x(\d+)/.exec(line);
    if (!frame) throw invalidMedia();
    frames.push({ index: Number(frame[1]), pts: Number(frame[2]), duration: Number(frame[3]), format: frame[4], sar: Number(frame[5]) / Number(frame[6]), width: Number(frame[7]), height: Number(frame[8]) });
  }
  if (!frames.length) throw invalidMedia();
  return frames;
}

function validateVideoDecode(result, info, config) {
  const frames = decodedFrames(result.stderr);
  if (frames.length !== info.frameCount || !result.progress.endsWith('progress=end\n')) throw invalidMedia();
  let previous = -1;
  let end = 0;
  for (const frame of frames) {
    const packet = info.packets[frame.index];
    if (frame.index !== previous + 1 || frame.pts !== packet?.pts || !Number.isSafeInteger(frame.duration) || frame.duration < 0 || frame.width !== info.width || frame.height !== info.height || frame.sar !== 1 || !['yuv420p', 'yuvj420p'].includes(frame.format)) throw invalidMedia();
    if (frame.index > 0 && frame.pts < end - 1) throw invalidMedia();
    if (frame.index === 0 && frame.pts * info.timeBase.value > 0.1) throw invalidMedia();
    const duration = packet.duration;
    if (duration <= 0 || duration * info.timeBase.value < 1 / HARD_LIMITS.fps - info.timeBase.value) throw invalidMedia();
    end = frame.pts + duration;
    if (millisecondsFromTicks(end, info.timeBase) > config.maxDurationMs) throw invalidMedia();
    previous = frame.index;
  }
  const decodedDuration = end * info.timeBase.numerator / info.timeBase.denominator;
  if (Math.abs(decodedDuration - Number(info.video.duration)) > 0.002) throw invalidMedia();
  if (Math.abs(frames.length / decodedDuration - info.fps) > 0.1) throw invalidMedia();

  let audioSamples = 0;
  let audioFrames = 0;
  let peak = -Infinity;
  let audioStart;
  const lines = result.stdout.toString('utf8').trim().split('\n');
  if (lines.length % 3 !== 0) throw invalidMedia();
  for (let index = 0; index < lines.length; index += 3) {
    const frame = /^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:\S+$/.exec(lines[index]);
    const peakMatch = /^lavfi\.astats\.Overall\.Peak_level=(\S+)$/.exec(lines[index + 1]);
    const samplesMatch = /^lavfi\.astats\.Overall\.Number_of_samples=(\S+)$/.exec(lines[index + 2]);
    if (!frame || !peakMatch || !samplesMatch || Number(frame[1]) !== audioFrames++) throw invalidMedia();
    const pts = Number(frame[2]);
    if (!Number.isSafeInteger(pts)) throw invalidMedia();
    audioStart ??= pts;
    if (audioStart < 0 || audioStart / info.sampleRate > 0.1 || Math.abs(pts - audioStart - audioSamples) > 1) throw invalidMedia();
    const samples = integer(samplesMatch[1], (config.maxDurationMs / 1000) * info.sampleRate + 1024);
    if (samples <= audioSamples || samples - audioSamples > 1024) throw invalidMedia();
    audioSamples = samples;
    peak = Number(peakMatch[1]);
  }
  const audioDuration = audioSamples / info.sampleRate;
  if (!audioFrames || !Number.isFinite(peak) || peak <= -80 || Math.abs(audioDuration - decodedDuration) > 0.2 || audioDuration > Number(info.audio.duration) + 1024 / info.sampleRate + 0.001) throw invalidMedia();
  return Math.max(Math.ceil(info.duration * 1000), millisecondsFromTicks(end, info.timeBase));
}

function cleanJpeg(bytes) {
  if (bytes.length > HARD_LIMITS.imageOutputBytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalidMedia();
  const parts = [bytes.subarray(0, 2)];
  let offset = 2;
  let width;
  let height;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw invalidMedia();
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) throw invalidMedia();
    if (marker === 0xc0 || marker === 0xc2) {
      height = bytes.readUInt16BE(offset + 5);
      width = bytes.readUInt16BE(offset + 7);
    }
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      if (!width || !height || width > 512 || height > 512) throw invalidMedia();
      return { bytes: Buffer.concat(parts), width, height };
    }
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  throw invalidMedia();
}

async function jpeg(path, video, config, signal, size) {
  const result = await runProcess('/usr/bin/ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-filter_threads', '1', ...inputOptions,
    ...(video ? ['-format_whitelist', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0'] : ['-f', 'image2']),
    '-i', path, '-map', '0:v:0', '-an', '-sn', '-dn', '-frames:v', '1', '-vf', `scale=w=${size}:h=${size}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-map_metadata', '-1', '-map_chapters', '-1', '-c:v', 'mjpeg', '-threads', '1', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-flags:v', '+bitexact', '-f', 'image2pipe', 'pipe:1',
  ], { signal, timeoutMs: Math.min(config.processTimeoutMs, 2000), maxOutputBytes: HARD_LIMITS.imageOutputBytes });
  if (result.stderr.trim()) throw invalidMedia();
  return cleanJpeg(result.stdout);
}

export async function verifyBytes(bytes, kind, config, signal) {
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > (kind === 'video' ? config.maxBytes : config.maxAvatarBytes)) throw invalidMedia();
  let format;
  let container;
  if (kind === 'video') container = inspectMp4(bytes, config.maxDurationMs);
  else format = await avatarFormat(bytes, signal);
  const directory = await mkdtemp(join(config.tempRoot, 'take-verify-'));
  try {
    const path = join(directory, kind === 'video' ? 'input.mp4' : `input.${format}`);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600, signal });
    const metadata = await probe(path, kind === 'video', config, signal);
    if (kind === 'video') {
      const info = videoMetadata(metadata, container, config);
      const decoded = await runProcess('/usr/bin/ffmpeg', [
        ...decodeOptions, ...inputOptions, '-format_whitelist', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', path,
        '-map', '0:v:0', '-map', '0:a:0', '-vf', 'showinfo=checksum=0',
        '-af', "astats=metadata=1:reset=0:measure_perchannel=none:measure_overall=Peak_level+Number_of_samples,ametadata=mode=print:file='pipe\\:1'",
        '-fps_mode', 'passthrough', '-threads', '1', '-progress', 'pipe:3', '-stats_period', '0.25', '-max_error_rate', '0', '-f', 'null', '-',
      ], { signal, timeoutMs: config.processTimeoutMs });
      const durationMs = validateVideoDecode(decoded, info, config);
      let thumbnailBase64 = null;
      try {
        thumbnailBase64 = (await jpeg(path, true, config, signal, 320)).bytes.toString('base64');
      } catch (error) {
        signal.throwIfAborted();
        if (error.status === 503) throw error;
      }
      return { durationMs, width: info.width, height: info.height, videoCodec: 'h264', audioCodec: 'aac', thumbnailBase64 };
    }

    if (metadata.streams?.length !== 1) throw invalidMedia();
    const image = metadata.streams[0];
    if (image.codec_type !== 'video' || image.codec_name !== (format === 'jpeg' ? 'mjpeg' : 'png')) throw invalidMedia();
    dimensions(image.width, image.height, HARD_LIMITS.avatarPixels, HARD_LIMITS.avatarDimension);
    const decoded = await runProcess('/usr/bin/ffmpeg', [
      ...decodeOptions, ...inputOptions, '-nofind_stream_info', '-f', 'image2', '-i', path, '-map', '0:v:0', '-an', '-vf', 'showinfo=checksum=0', '-fps_mode', 'passthrough', '-threads', '1', '-max_error_rate', '0', '-f', 'null', '-',
    ], { signal, timeoutMs: config.processTimeoutMs });
    const frames = decodedFrames(decoded.stderr);
    if (frames.length !== 1 || frames[0].index !== 0) throw invalidMedia();
    dimensions(frames[0].width, frames[0].height, HARD_LIMITS.avatarPixels, HARD_LIMITS.avatarDimension);
    const normalized = await jpeg(path, false, config, signal, 512);
    return { width: normalized.width, height: normalized.height, mimeType: 'image/jpeg', imageBase64: normalized.bytes.toString('base64') };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
