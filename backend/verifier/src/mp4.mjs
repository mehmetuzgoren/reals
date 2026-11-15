import { HARD_LIMITS, invalidMedia } from './config.mjs';

const brands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ']);

function boxes(bytes, start, end) {
  const result = [];
  let offset = start;
  while (offset < end) {
    if (result.length >= 1024 || end - offset < 8) throw invalidMedia();
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (end - offset < 16) throw invalidMedia();
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(end - offset)) throw invalidMedia();
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || size > end - offset) throw invalidMedia();
    result.push({ type: bytes.toString('latin1', offset + 4, offset + 8), data: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function only(items, type) {
  const matches = items.filter((item) => item.type === type);
  if (matches.length !== 1) throw invalidMedia();
  return matches[0];
}

function timing(bytes, box) {
  const version = bytes[box.data];
  if (![0, 1].includes(version) || box.end - box.data < (version === 0 ? 20 : 32)) throw invalidMedia();
  const timeScale = bytes.readUInt32BE(box.data + (version === 0 ? 12 : 20));
  const ticks = version === 0 ? BigInt(bytes.readUInt32BE(box.data + 16)) : bytes.readBigUInt64BE(box.data + 24);
  if (!timeScale || ticks <= 0n) throw invalidMedia();
  return { timeScale, ticks };
}

function bounded(ticks, timeScale, maximum) {
  if (ticks <= 0n || ticks * 1000n > BigInt(maximum) * BigInt(timeScale)) throw invalidMedia();
}

export function inspectMp4(bytes, maxDurationMs) {
  const top = boxes(bytes, 0, bytes.length);
  const first = top[0];
  if (!first || first.type !== 'ftyp' || first.end - first.data < 8 || !brands.has(bytes.toString('latin1', first.data, first.data + 4))) throw invalidMedia();
  if (top.filter((box) => box.type === 'ftyp').length !== 1 || !top.some((box) => box.type === 'mdat' && box.end > box.data)) throw invalidMedia();
  if (top.some((box) => !['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid'].includes(box.type))) throw invalidMedia();
  const movie = only(top, 'moov');
  const movieBoxes = boxes(bytes, movie.data, movie.end);
  const movieTime = timing(bytes, only(movieBoxes, 'mvhd'));
  bounded(movieTime.ticks, movieTime.timeScale, maxDurationMs);
  const tracks = movieBoxes.filter((box) => box.type === 'trak');
  if (tracks.length !== 2) throw invalidMedia();
  let video;
  let audioCount = 0;
  for (const track of tracks) {
    const trackBoxes = boxes(bytes, track.data, track.end);
    const trackHeader = only(trackBoxes, 'tkhd');
    const version = bytes[trackHeader.data];
    if (![0, 1].includes(version) || trackHeader.end - trackHeader.data < (version === 0 ? 24 : 36)) throw invalidMedia();
    const trackTicks = version === 0 ? BigInt(bytes.readUInt32BE(trackHeader.data + 20)) : bytes.readBigUInt64BE(trackHeader.data + 28);
    bounded(trackTicks, movieTime.timeScale, maxDurationMs);
    const editBoxes = trackBoxes.filter((box) => box.type === 'edts');
    if (editBoxes.length > 1) throw invalidMedia();
    if (editBoxes.length) {
      const edits = only(boxes(bytes, editBoxes[0].data, editBoxes[0].end), 'elst');
      const editVersion = bytes[edits.data];
      if (![0, 1].includes(editVersion) || edits.end - edits.data < 8) throw invalidMedia();
      const count = bytes.readUInt32BE(edits.data + 4);
      const entrySize = editVersion === 0 ? 12 : 20;
      if (count < 1 || count > 2 || edits.end - edits.data !== 8 + count * entrySize) throw invalidMedia();
      let total = 0n;
      for (let index = 0; index < count; index++) {
        const offset = edits.data + 8 + index * entrySize;
        const duration = editVersion === 0 ? BigInt(bytes.readUInt32BE(offset)) : bytes.readBigUInt64BE(offset);
        const mediaTime = editVersion === 0 ? BigInt(bytes.readInt32BE(offset + 4)) : bytes.readBigInt64BE(offset + 8);
        if (bytes.readInt16BE(offset + entrySize - 4) !== 1 || bytes.readInt16BE(offset + entrySize - 2) !== 0) throw invalidMedia();
        if (count === 2 && index === 0 && mediaTime !== -1n) throw invalidMedia();
        if (mediaTime < 0n && (mediaTime !== -1n || index !== 0 || count !== 2 || duration * 1000n > 100n * BigInt(movieTime.timeScale))) throw invalidMedia();
        bounded(duration, movieTime.timeScale, maxDurationMs);
        total += duration;
      }
      bounded(total, movieTime.timeScale, maxDurationMs);
      if (total !== trackTicks) throw invalidMedia();
    }
    const media = only(trackBoxes, 'mdia');
    const mediaBoxes = boxes(bytes, media.data, media.end);
    const handler = only(mediaBoxes, 'hdlr');
    if (handler.end - handler.data < 12) throw invalidMedia();
    const kind = bytes.toString('latin1', handler.data + 8, handler.data + 12);
    if (kind === 'soun') {
      audioCount++;
      continue;
    }
    if (kind !== 'vide' || video) throw invalidMedia();
    const mediaTime = timing(bytes, only(mediaBoxes, 'mdhd'));
    bounded(mediaTime.ticks, mediaTime.timeScale, maxDurationMs);
    const info = only(mediaBoxes, 'minf');
    const table = only(boxes(bytes, info.data, info.end), 'stbl');
    const stts = only(boxes(bytes, table.data, table.end), 'stts');
    if (stts.end - stts.data < 8 || bytes.readUInt32BE(stts.data) !== 0) throw invalidMedia();
    const count = bytes.readUInt32BE(stts.data + 4);
    const maxFrames = Math.ceil(HARD_LIMITS.fps * maxDurationMs / 1000);
    if (!count || count > maxFrames || stts.end - stts.data !== 8 + count * 8) throw invalidMedia();
    const durations = [];
    let totalTicks = 0n;
    for (let index = 0; index < count; index++) {
      const offset = stts.data + 8 + index * 8;
      const samples = bytes.readUInt32BE(offset);
      const duration = bytes.readUInt32BE(offset + 4);
      if (!samples || !duration || samples > maxFrames - durations.length) throw invalidMedia();
      totalTicks += BigInt(samples) * BigInt(duration);
      bounded(totalTicks, mediaTime.timeScale, maxDurationMs);
      for (let sample = 0; sample < samples; sample++) durations.push(duration);
    }
    if (totalTicks !== mediaTime.ticks) throw invalidMedia();
    video = { timeScale: mediaTime.timeScale, durations };
  }
  if (!video || audioCount !== 1) throw invalidMedia();
  return video;
}
