import { fail } from "./errors";

type Box = { type: string; data: number; end: number };
type Region = { start: number; end: number };
const brands = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "hvc1", "hev1", "M4V ", "qt  "]);
function invalid(): never { return fail("INVALID_MEDIA", "Unsupported or structurally invalid MP4/MOV video"); }

class Reader {
  readonly view: DataView;
  boxCount = 0;
  sampleCount = 0;
  nalCount = 0;
  readonly regions: Region[] = [];
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  need(offset: number, length: number, end = this.bytes.length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > end - length || end > this.bytes.length) invalid();
  }
  u16(offset: number) { this.need(offset, 2); return this.view.getUint16(offset); }
  u32(offset: number) { this.need(offset, 4); return this.view.getUint32(offset); }
  i32(offset: number) { this.need(offset, 4); return this.view.getInt32(offset); }
  u64(offset: number) {
    this.need(offset, 8);
    const value = this.view.getBigUint64(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
    return Number(value);
  }
  text(offset: number, length: number) {
    this.need(offset, length);
    return String.fromCharCode(...this.bytes.subarray(offset, offset + length));
  }
  boxes(start: number, end: number) {
    this.need(start, end - start);
    const result: Box[] = [];
    while (start < end) {
      if (++this.boxCount > 4096) invalid();
      this.need(start, 8, end);
      let size = this.u32(start);
      let header = 8;
      if (size === 1) { this.need(start, 16, end); size = this.u64(start + 8); header = 16; }
      else if (size === 0) size = end - start;
      if (size < header || size > end - start) invalid();
      result.push({ type: this.text(start + 4, 4), data: start + header, end: start + size });
      start += size;
    }
    return result;
  }
  full(box: Box, versions = [0]) {
    this.need(box.data, 4, box.end);
    const version = this.bytes[box.data];
    if (!versions.includes(version)) invalid();
    return version;
  }
}

function only(boxes: Box[], type: string) {
  const found = boxes.filter(box => box.type === type);
  if (found.length !== 1) invalid();
  return found[0];
}
function optional(boxes: Box[], type: string) {
  const found = boxes.filter(box => box.type === type);
  if (found.length > 1) invalid();
  return found[0];
}
function timing(r: Reader, box: Box) {
  const version = r.full(box, [0, 1]);
  r.need(box.data, version === 0 ? 20 : 32, box.end);
  const scale = r.u32(box.data + (version === 0 ? 12 : 20));
  const ticks = version === 0 ? r.u32(box.data + 16) : r.u64(box.data + 24);
  if (!scale || !ticks) invalid();
  return { scale, ticks };
}
function duration(ticks: number | bigint, scale: number, minimum = 0) {
  const value = BigInt(ticks) * 1000n;
  if (ticks <= 0 || !scale || value < BigInt(minimum) * BigInt(scale) || value > 15000n * BigInt(scale)) invalid();
}
function trackHeader(r: Reader, box: Box, movieScale: number, video: boolean) {
  const version = r.full(box, [0, 1]);
  r.need(box.data, version === 0 ? 84 : 96, box.end);
  const ticks = version === 0 ? r.u32(box.data + 20) : r.u64(box.data + 28);
  duration(ticks, movieScale, video ? 3000 : 0);
  const matrix = box.data + (version === 0 ? 40 : 52);
  const a = r.i32(matrix), b = r.i32(matrix + 4), c = r.i32(matrix + 12), d = r.i32(matrix + 16);
  if (r.i32(matrix + 8) !== 0 || r.i32(matrix + 20) !== 0 || r.i32(matrix + 32) !== 1073741824 ||
    Math.abs(r.i32(matrix + 24)) > 8192 * 65536 || Math.abs(r.i32(matrix + 28)) > 8192 * 65536) invalid();
  if (!((a === 65536 && b === 0 && c === 0 && d === 65536) || (a === -65536 && b === 0 && c === 0 && d === -65536) ||
    (a === 0 && b === 65536 && c === -65536 && d === 0) || (a === 0 && b === -65536 && c === 65536 && d === 0))) invalid();
  if (video) {
    const width = r.u32(matrix + 36) / 65536, height = r.u32(matrix + 40) / 65536;
    if (width <= 0 || height <= 0 || width > 4096 || height > 4096) invalid();
  }
  return { ticks, rotated: a === 0 };
}
function editList(r: Reader, box: Box | undefined, trackTicks: number, movieScale: number) {
  if (!box) return { mediaStart: 0, mappedTicks: trackTicks };
  const edits = only(r.boxes(box.data, box.end), "elst");
  const version = r.full(edits, [0, 1]);
  r.need(edits.data, 8, edits.end);
  const count = r.u32(edits.data + 4), size = version === 0 ? 12 : 20;
  if (count < 1 || count > 2 || edits.end - edits.data !== 8 + count * size) invalid();
  let total = 0n;
  let mediaStart = 0, mappedTicks = 0;
  for (let index = 0; index < count; index++) {
    const offset = edits.data + 8 + index * size;
    const ticks = version === 0 ? r.u32(offset) : r.u64(offset);
    const mediaTime = version === 0 ? BigInt(r.i32(offset + 4)) : r.view.getBigInt64(offset + 8);
    if (r.u16(offset + size - 4) !== 1 || r.u16(offset + size - 2) !== 0 || mediaTime < -1n || mediaTime > BigInt(Number.MAX_SAFE_INTEGER) ||
      (count === 2 && index === 0 && mediaTime !== -1n) ||
      (mediaTime === -1n && (index !== 0 || count !== 2 || BigInt(ticks) * 1000n > 100n * BigInt(movieScale)))) invalid();
    if (mediaTime >= 0n) { mediaStart = Number(mediaTime); mappedTicks = ticks; }
    duration(ticks, movieScale);
    total += BigInt(ticks);
  }
  if (total !== BigInt(trackTicks)) invalid();
  return { mediaStart, mappedTicks };
}
function videoConfig(r: Reader, entry: Box, hevc: boolean) {
  const config = only(r.boxes(entry.data + 78, entry.end), hevc ? "hvcC" : "avcC");
  r.need(config.data, hevc ? 23 : 7, config.end);
  if (r.bytes[config.data] !== 1) invalid();
  const lengthSize = (r.bytes[config.data + (hevc ? 21 : 4)] & 3) + 1;
  if (lengthSize === 3) invalid();
  let offset = config.data + (hevc ? 23 : 6);
  const units = (count: number, expected?: number) => {
    if (count > 128) invalid();
    for (let index = 0; index < count; index++) {
      r.need(offset, 2, config.end);
      const size = r.u16(offset); offset += 2;
      r.need(offset, size, config.end);
      if (size < (hevc ? 3 : 2) || ++r.nalCount > 20000 || (expected !== undefined && (r.bytes[offset] & 31) !== expected)) invalid();
      offset += size;
    }
  };
  if (hevc) {
    const arrays = r.bytes[config.data + 22];
    if (arrays > 64) invalid();
    for (let index = 0; index < arrays; index++) {
      r.need(offset, 3, config.end);
      const count = r.u16(offset + 1); offset += 3; units(count);
    }
  } else {
    const count = r.bytes[config.data + 5] & 31;
    if (entry.type === "avc1" && !count) invalid();
    units(count, 7);
    r.need(offset, 1, config.end);
    const pps = r.bytes[offset++];
    if (entry.type === "avc1" && !pps) invalid();
    units(pps, 8);
    if (offset < config.end) {
      if (![100, 110, 122, 144, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(r.bytes[config.data + 1])) invalid();
      r.need(offset, 4, config.end);
      const extensions = r.bytes[offset + 3]; offset += 4; units(extensions, 13);
    }
  }
  if (offset !== config.end) invalid();
  return lengthSize;
}
function audioConfig(r: Reader, entry: Box) {
  r.need(entry.data, 28, entry.end);
  const version = r.u16(entry.data + 8);
  if (version !== 0 && version !== 1) invalid();
  const channels = r.u16(entry.data + 16), rate = r.u32(entry.data + 24) / 65536;
  if (channels < 1 || channels > 2 || rate < 8000 || rate > 96000) invalid();
  const nested = r.boxes(entry.data + (version === 1 ? 44 : 28), entry.end);
  const wave = optional(nested, "wave");
  const esds = wave ? only(r.boxes(wave.data, wave.end), "esds") : only(nested, "esds");
  r.full(esds);
  const descriptor = (offset: number, end: number) => {
    r.need(offset, 2, end);
    const tag = r.bytes[offset++];
    let size = 0, done = false;
    for (let index = 0; index < 4; index++) {
      r.need(offset, 1, end);
      const value = r.bytes[offset++]; size = size * 128 + (value & 127);
      if (!(value & 128)) { done = true; break; }
    }
    if (!done) invalid();
    r.need(offset, size, end);
    return { tag, data: offset, end: offset + size };
  };
  const es = descriptor(esds.data + 4, esds.end);
  if (es.tag !== 3 || es.end !== esds.end) invalid();
  r.need(es.data, 3, es.end);
  const flags = r.bytes[es.data + 2];
  let offset = es.data + 3;
  if (flags & 128) offset += 2;
  if (flags & 64) { r.need(offset, 1, es.end); offset += 1 + r.bytes[offset]; }
  if (flags & 32) offset += 2;
  const decoder = descriptor(offset, es.end);
  if (decoder.tag !== 4) invalid();
  r.need(decoder.data, 13, decoder.end);
  if (r.bytes[decoder.data] !== 0x40 || ((r.bytes[decoder.data + 1] >> 2) & 63) !== 5) invalid();
  const specific = descriptor(decoder.data + 13, decoder.end);
  if (specific.tag !== 5) invalid();
  r.need(specific.data, 2, specific.end);
  const objectType = r.bytes[specific.data] >> 3;
  if (![1, 2, 3, 4, 5, 29].includes(objectType)) invalid();
}
function sizes(r: Reader, boxes: Box[], video: boolean) {
  const stsz = optional(boxes, "stsz"), stz2 = optional(boxes, "stz2");
  if ((!stsz && !stz2) || (stsz && stz2)) invalid();
  const box = (stsz ?? stz2)!;
  r.full(box); r.need(box.data, 12, box.end);
  const count = r.u32(box.data + 8);
  if (!count || count > (video ? 900 : 8192) || (r.sampleCount += count) > 10000) invalid();
  const result: number[] = [];
  if (stsz) {
    const fixed = r.u32(box.data + 4);
    if (box.end - box.data !== 12 + (fixed ? 0 : count * 4)) invalid();
    for (let index = 0; index < count; index++) result.push(fixed || r.u32(box.data + 12 + index * 4));
  } else {
    const bits = r.bytes[box.data + 7];
    if (![4, 8, 16].includes(bits) || box.end - box.data !== 12 + Math.ceil(count * bits / 8)) invalid();
    for (let index = 0; index < count; index++) {
      const offset = box.data + 12 + Math.floor(index * bits / 8);
      result.push(bits === 16 ? r.u16(offset) : bits === 8 ? r.bytes[offset] : (r.bytes[offset] >> (index % 2 === 0 ? 4 : 0)) & 15);
    }
  }
  if (result.some(size => !size || size > r.bytes.length)) invalid();
  return result;
}
function sampleTiming(r: Reader, boxes: Box[], count: number, scale: number, mediaTicks: number, video: boolean, audioPriming: number) {
  const stts = only(boxes, "stts");
  r.full(stts); r.need(stts.data, 8, stts.end);
  const entries = r.u32(stts.data + 4);
  if (!entries || entries > count || stts.end - stts.data !== 8 + entries * 8) invalid();
  let samples = 0, ticks = 0n;
  const deltas: number[] = [];
  for (let index = 0; index < entries; index++) {
    const offset = stts.data + 8 + index * 8;
    const amount = r.u32(offset), delta = r.u32(offset + 4);
    if (!amount || !delta || amount > count - samples || (video && BigInt(scale) > 60n * BigInt(delta))) invalid();
    for (let sample = 0; sample < amount; sample++) deltas.push(delta);
    samples += amount; ticks += BigInt(amount) * BigInt(delta);
  }
  if (samples !== count || ticks !== BigInt(mediaTicks)) invalid();
  duration(video ? ticks : ticks - BigInt(audioPriming), scale, video ? 3000 : 0);
  const ctts = optional(boxes, "ctts");
  const compositionOffsets = new Array<number>(count).fill(0);
  if (ctts) {
    const version = r.full(ctts, [0, 1]); r.need(ctts.data, 8, ctts.end);
    const entries = r.u32(ctts.data + 4);
    if (!entries || entries > count || ctts.end - ctts.data !== 8 + entries * 8) invalid();
    let total = 0;
    for (let index = 0; index < entries; index++) {
      const offset = ctts.data + 8 + index * 8;
      const amount = r.u32(offset), delta = version === 0 ? r.u32(offset + 4) : r.i32(offset + 4);
      if (!amount || amount > count - total || Math.abs(delta) > mediaTicks) invalid();
      compositionOffsets.fill(delta, total, total + amount);
      total += amount;
    }
    if (total !== count) invalid();
  }
  let decodeTime = 0n, presentationStart = BigInt(compositionOffsets[0]), presentationEnd = presentationStart;
  for (let sample = 0; sample < count; sample++) {
    const start = decodeTime + BigInt(compositionOffsets[sample]);
    const end = start + BigInt(deltas[sample]);
    if (start < presentationStart) presentationStart = start;
    if (end > presentationEnd) presentationEnd = end;
    decodeTime += BigInt(deltas[sample]);
  }
  const stss = optional(boxes, "stss");
  if (stss) {
    r.full(stss); r.need(stss.data, 8, stss.end);
    const entries = r.u32(stss.data + 4);
    if (!entries || entries > count || stss.end - stss.data !== 8 + entries * 4) invalid();
    let previous = 0;
    for (let index = 0; index < entries; index++) {
      const sample = r.u32(stss.data + 8 + index * 4);
      if (sample <= previous || sample > count) invalid();
      previous = sample;
    }
  }
  return { presentationStart, presentationEnd };
}
function nalSample(r: Reader, start: number, end: number, lengthSize: number, hevc: boolean) {
  let vcl = false;
  while (start < end) {
    r.need(start, lengthSize, end);
    let length = 0;
    for (let index = 0; index < lengthSize; index++) length = length * 256 + r.bytes[start++];
    r.need(start, length, end);
    if (length < (hevc ? 3 : 2) || ++r.nalCount > 20000 || (r.bytes[start] & 128)) invalid();
    const type = hevc ? (r.bytes[start] >> 1) & 63 : r.bytes[start] & 31;
    if (hevc ? !(r.bytes[start + 1] & 7) : type === 0 || type > 23) invalid();
    if (hevc ? type <= 31 : type >= 1 && type <= 5) vcl = true;
    start += length;
  }
  if (!vcl) invalid();
}
function sampleData(r: Reader, boxes: Box[], sampleSizes: number[], mdats: Region[], lengthSize: number, hevc: boolean) {
  const stco = optional(boxes, "stco"), co64 = optional(boxes, "co64");
  if ((!stco && !co64) || (stco && co64)) invalid();
  const offsets = (stco ?? co64)!;
  r.full(offsets); r.need(offsets.data, 8, offsets.end);
  const chunks = r.u32(offsets.data + 4), offsetSize = stco ? 4 : 8;
  if (!chunks || chunks > sampleSizes.length || offsets.end - offsets.data !== 8 + chunks * offsetSize) invalid();
  const stsc = only(boxes, "stsc");
  r.full(stsc); r.need(stsc.data, 8, stsc.end);
  const entries = r.u32(stsc.data + 4);
  if (!entries || entries > chunks || stsc.end - stsc.data !== 8 + entries * 12) invalid();
  const runs: { first: number; samples: number }[] = [];
  for (let index = 0; index < entries; index++) {
    const offset = stsc.data + 8 + index * 12;
    const first = r.u32(offset), samples = r.u32(offset + 4);
    if (first < 1 || first > chunks || (index === 0 ? first !== 1 : first <= runs[index - 1].first) || !samples || samples > sampleSizes.length || r.u32(offset + 8) !== 1) invalid();
    runs.push({ first, samples });
  }
  let sample = 0, run = 0;
  for (let chunk = 1; chunk <= chunks; chunk++) {
    if (run + 1 < runs.length && runs[run + 1].first === chunk) run++;
    const offset = offsets.data + 8 + (chunk - 1) * offsetSize;
    let start = stco ? r.u32(offset) : r.u64(offset);
    const beginning = start;
    for (let index = 0; index < runs[run].samples; index++) {
      if (sample >= sampleSizes.length) invalid();
      const size = sampleSizes[sample++];
      r.need(start, size);
      if (lengthSize) nalSample(r, start, start + size, lengthSize, hevc);
      start += size;
    }
    if (!mdats.some(region => beginning >= region.start && start <= region.end)) invalid();
    r.regions.push({ start: beginning, end: start });
  }
  if (sample !== sampleSizes.length) invalid();
}

export function inspectVideo(bytes: ArrayBuffer) {
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) invalid();
  const r = new Reader(new Uint8Array(bytes));
  const top = r.boxes(0, bytes.byteLength);
  if (top.some(box => !["ftyp", "moov", "mdat", "free", "skip", "wide", "uuid"].includes(box.type))) invalid();
  const ftyp = optional(top, "ftyp");
  if (ftyp) {
    r.need(ftyp.data, 8, ftyp.end);
    if ((ftyp.end - ftyp.data) % 4 || !brands.has(r.text(ftyp.data, 4))) invalid();
  }
  const mdats = top.filter(box => box.type === "mdat").map(box => ({ start: box.data, end: box.end }));
  if (!mdats.length || mdats.length > 16 || mdats.some(region => region.start === region.end)) invalid();
  const movie = only(top, "moov"), children = r.boxes(movie.data, movie.end);
  if (children.some(box => box.type === "mvex")) invalid();
  const movieTime = timing(r, only(children, "mvhd"));
  duration(movieTime.ticks, movieTime.scale, 3000);
  const tracks = children.filter(box => box.type === "trak");
  if (tracks.length < 1 || tracks.length > 2) invalid();
  let video: { durationMs: number; width: number; height: number } | null = null;
  let audio = false;
  for (const track of tracks) {
    const trackBoxes = r.boxes(track.data, track.end), media = only(trackBoxes, "mdia"), mediaBoxes = r.boxes(media.data, media.end);
    const handler = only(mediaBoxes, "hdlr");
    r.full(handler); r.need(handler.data, 12, handler.end);
    const kind = r.text(handler.data + 8, 4), isVideo = kind === "vide";
    if ((!isVideo && kind !== "soun") || (isVideo ? video !== null : audio)) invalid();
    const header = trackHeader(r, only(trackBoxes, "tkhd"), movieTime.scale, isVideo);
    const editBox = optional(trackBoxes, "edts");
    const edits = editList(r, editBox, header.ticks, movieTime.scale);
    const mediaTime = timing(r, only(mediaBoxes, "mdhd"));
    if (!isVideo && (BigInt(edits.mediaStart) * 1000n > 100n * BigInt(mediaTime.scale) ||
      BigInt(edits.mediaStart) * BigInt(movieTime.scale) + BigInt(edits.mappedTicks) * BigInt(mediaTime.scale) > BigInt(mediaTime.ticks) * BigInt(movieTime.scale))) invalid();
    const info = only(mediaBoxes, "minf"), infoBoxes = r.boxes(info.data, info.end);
    const dinf = only(infoBoxes, "dinf"), dref = only(r.boxes(dinf.data, dinf.end), "dref");
    r.full(dref); r.need(dref.data, 8, dref.end);
    if (r.u32(dref.data + 4) !== 1) invalid();
    const url = only(r.boxes(dref.data + 8, dref.end), "url ");
    if (url.end - url.data !== 4 || r.u32(url.data) !== 1) invalid();
    const table = only(infoBoxes, "stbl"), tableBoxes = r.boxes(table.data, table.end), stsd = only(tableBoxes, "stsd");
    r.full(stsd); r.need(stsd.data, 8, stsd.end);
    if (r.u32(stsd.data + 4) !== 1) invalid();
    const descriptions = r.boxes(stsd.data + 8, stsd.end);
    if (descriptions.length !== 1) invalid();
    const entry = descriptions[0];
    r.need(entry.data, 8, entry.end);
    if (r.u16(entry.data + 6) !== 1) invalid();
    let lengthSize = 0, hevc = false;
    if (isVideo) {
      if (!["avc1", "avc3", "hvc1", "hev1"].includes(entry.type)) invalid();
      r.need(entry.data, 78, entry.end);
      const codedWidth = r.u16(entry.data + 24), codedHeight = r.u16(entry.data + 26);
      const width = header.rotated ? codedHeight : codedWidth, height = header.rotated ? codedWidth : codedHeight;
      if (!width || !height || Math.min(width, height) > 2160 || Math.max(width, height) > 4096 || codedWidth * codedHeight > 2160 * 4096) invalid();
      hevc = entry.type === "hvc1" || entry.type === "hev1";
      const nested = r.boxes(entry.data + 78, entry.end), pasp = optional(nested, "pasp");
      if (pasp && (pasp.end - pasp.data !== 8 || !r.u32(pasp.data) || r.u32(pasp.data) !== r.u32(pasp.data + 4))) invalid();
      lengthSize = videoConfig(r, entry, hevc);
      video = { durationMs: mediaTime.ticks * 1000 / mediaTime.scale, width, height };
    } else {
      if (entry.type !== "mp4a") invalid();
      audioConfig(r, entry); audio = true;
    }
    const sampleSizes = sizes(r, tableBoxes, isVideo);
    const sampleTime = sampleTiming(r, tableBoxes, sampleSizes.length, mediaTime.scale, mediaTime.ticks, isVideo, isVideo ? 0 : edits.mediaStart);
    if (isVideo && editBox && (BigInt(edits.mediaStart) < sampleTime.presentationStart ||
      BigInt(edits.mediaStart) * BigInt(movieTime.scale) + BigInt(edits.mappedTicks) * BigInt(mediaTime.scale) > sampleTime.presentationEnd * BigInt(movieTime.scale))) invalid();
    sampleData(r, tableBoxes, sampleSizes, mdats, lengthSize, hevc);
  }
  if (!video) invalid();
  r.regions.sort((a, b) => a.start - b.start);
  for (let index = 1; index < r.regions.length; index++) if (r.regions[index].start < r.regions[index - 1].end) invalid();
  return video;
}
