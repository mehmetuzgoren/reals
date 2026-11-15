import { fail } from "./errors";

function invalid(): never { return fail("INVALID_MEDIA", "Unsupported or structurally invalid JPEG/PNG avatar"); }
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048) invalid();
  return { width, height };
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function jpeg(bytes: Uint8Array, view: DataView) {
  let offset = 2, markers = 0, scanning = false, scans = 0, entropy = 0;
  let frame: { width: number; height: number } | null = null;
  let components: number[] = [];
  let quantization = false, huffman = false;
  while (offset < bytes.length) {
    if (scanning) {
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) { entropy++; continue; }
        const start = offset - 1;
        while (offset < bytes.length && bytes[offset] === 0xff) offset++;
        if (offset >= bytes.length) invalid();
        const marker = bytes[offset++];
        if (marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) { entropy++; continue; }
        offset = start; scanning = false; break;
      }
    }
    if (++markers > 4096 || offset >= bytes.length || bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scans || !entropy || !quantization || !huffman || offset !== bytes.length) invalid();
      return { ...frame, mimeType: "image/jpeg" as const };
    }
    if ([0, 1, 0xd8].includes(marker) || (marker >= 0xd0 && marker <= 0xd7) || bytes.length - offset < 2) invalid();
    const length = view.getUint16(offset);
    if (length < 2 || length > bytes.length - offset) invalid();
    const end = offset + length;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 8 || bytes[offset + 2] !== 8) invalid();
      frame = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      const count = bytes[offset + 7];
      if (count < 1 || count > 4 || length !== 8 + count * 3) invalid();
      for (let index = 0; index < count; index++) {
        const start = offset + 8 + index * 3, id = bytes[start], sampling = bytes[start + 1];
        if (components.includes(id) || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[start + 2] > 3) invalid();
        components.push(id);
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4].includes(marker)) invalid();
    if (marker === 0xdb) {
      let start = offset + 2;
      while (start < end) {
        const info = bytes[start++], precision = info >> 4;
        if (precision > 1 || (info & 15) > 3 || end - start < 64 * (precision + 1)) invalid();
        start += 64 * (precision + 1);
      }
      if (start !== end || length === 2) invalid();
      quantization = true;
    }
    if (marker === 0xc4) {
      let start = offset + 2;
      while (start < end) {
        if (end - start < 17 || (bytes[start] >> 4) > 1 || (bytes[start] & 15) > 3) invalid();
        start++;
        let count = 0, slots = 1;
        for (let index = 0; index < 16; index++) {
          const amount = bytes[start++]; count += amount; slots = slots * 2 - amount;
          if (slots < 0) invalid();
        }
        if (!count || count > 256 || count > end - start) invalid();
        start += count;
      }
      if (start !== end || length === 2) invalid();
      huffman = true;
    }
    if (marker === 0xda) {
      if (!frame || length < 6 || !quantization || !huffman) invalid();
      const count = bytes[offset + 2];
      if (!count || count > components.length || length !== 6 + count * 2) invalid();
      const selectors = new Set<number>();
      for (let index = 0; index < count; index++) {
        const id = bytes[offset + 3 + index * 2], tables = bytes[offset + 4 + index * 2];
        if (!components.includes(id) || selectors.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) invalid();
        selectors.add(id);
      }
      scans++; scanning = true;
    }
    if (marker === 0xdd && length !== 4) invalid();
    offset = end;
  }
  return invalid();
}

function png(bytes: Uint8Array, view: DataView) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) invalid();
  let offset = 8, chunks = 0, palette = 0, color = -1, depth = 0, dataBytes = 0;
  let dataEnded = false, transparency = false;
  let frame: { width: number; height: number } | null = null;
  const compressedHeader: number[] = [];
  while (offset < bytes.length) {
    if (++chunks > 4096 || bytes.length - offset < 12) invalid();
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || /[a-z]/.test(type[2])) invalid();
    const data = offset + 8, end = data + length;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end)) invalid();
    if (chunks === 1) {
      if (type !== "IHDR" || length !== 13) invalid();
      frame = dimensions(view.getUint32(data), view.getUint32(data + 4));
      depth = bytes[data + 8]; color = bytes[data + 9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] > 1) invalid();
    } else if (type === "IHDR") invalid();
    if (type === "PLTE") {
      if (dataBytes || transparency || palette || [0, 4].includes(color) || length < 3 || length > 768 || length % 3) invalid();
      palette = length / 3;
      if (color === 3 && palette > 2 ** depth) invalid();
    }
    if (type === "IDAT") {
      if (dataEnded || (color === 3 && !palette)) invalid();
      for (let index = data; index < end && compressedHeader.length < 2; index++) compressedHeader.push(bytes[index]);
      dataBytes += length;
    } else if (dataBytes) dataEnded = true;
    if (type === "tRNS") {
      if (dataBytes || transparency || !((color === 0 && length === 2) || (color === 2 && length === 6) || (color === 3 && palette && length > 0 && length <= palette))) invalid();
      transparency = true;
    }
    if (["acTL", "fcTL", "fdAT"].includes(type) || ((type.charCodeAt(0) & 32) === 0 && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type))) invalid();
    offset = end + 4;
    if (type === "IEND") {
      if (!frame || length !== 0 || offset !== bytes.length || dataBytes < 6 || compressedHeader.length !== 2 ||
        (compressedHeader[0] & 15) !== 8 || (compressedHeader[0] >> 4) > 7 || (compressedHeader[1] & 32) || ((compressedHeader[0] << 8) + compressedHeader[1]) % 31) invalid();
      return { ...frame, mimeType: "image/png" as const };
    }
  }
  return invalid();
}

export function inspectAvatar(buffer: ArrayBuffer) {
  if (!buffer.byteLength || buffer.byteLength > 2 * 1024 * 1024) invalid();
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? jpeg(bytes, view) : png(bytes, view);
}
