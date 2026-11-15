import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const execute = promisify(execFile);

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

export async function fixtures() {
  const directory = await mkdtemp(join(tmpdir(), 'take-verifier-fixtures-'));
  const files = {};
  const ffmpeg = async (name, args) => {
    const path = join(directory, name);
    await execute('/usr/bin/ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-filter_threads', '1', '-filter_complex_threads', '1', '-y', ...args, path], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    files[name] = await readFile(path);
    return path;
  };
  const video = async (name, { size = '96x160', duration = '1', audio = 'sine=frequency=440:sample_rate=48000', videoCodec = 'libx264', audioCodec = 'aac' } = {}) => ffmpeg(name, [
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=15`,
    ...(audio ? ['-f', 'lavfi', '-i', audio] : []),
    '-t', duration, '-c:v', videoCodec, '-threads', '1', '-pix_fmt', 'yuv420p',
    ...(audio ? ['-c:a', audioCodec] : ['-an']), '-movflags', '+faststart',
  ]);
  try {
    await video('valid.mp4');
    await ffmpeg('native-stereo.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-video_track_timescale', '600', '-movflags', '+faststart']);
    const landscape = await video('landscape.mp4', { size: '160x96' });
    await ffmpeg('rotated.mp4', ['-display_rotation', '90', '-i', landscape, '-c', 'copy']);
    await ffmpeg('rotated-landscape.mp4', ['-display_rotation', '90', '-i', join(directory, 'valid.mp4'), '-c', 'copy']);
    await video('silent.mp4', { audio: 'anullsrc=r=48000:cl=mono' });
    await video('no-audio.mp4', { audio: null });
    await video('wrong-video.mp4', { videoCodec: 'mpeg4' });
    await video('wrong-audio.mp4', { audioCodec: 'libmp3lame' });
    await video('at-limit.mp4', { size: '32x64', duration: '15' });
    await ffmpeg('at-limit-600.mp4', ['-i', join(directory, 'at-limit.mp4'), '-c', 'copy', '-video_track_timescale', '600']);
    await video('over-limit.mp4', { size: '32x64', duration: '15.1' });
    await ffmpeg('fast.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=32x64:rate=120', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']);
    await ffmpeg('avatar.jpg', ['-f', 'lavfi', '-i', 'testsrc2=size=1200x800', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1', '-q:v', '4']);
    await ffmpeg('avatar.png', ['-f', 'lavfi', '-i', 'testsrc2=size=480x640', '-frames:v', '1', '-c:v', 'png', '-threads', '1']);
    await ffmpeg('avatar.gif', ['-f', 'lavfi', '-i', 'testsrc2=size=64x64', '-frames:v', '1', '-threads', '1']);
    await ffmpeg('animated.png', ['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2', '-frames:v', '2', '-c:v', 'apng', '-threads', '1', '-f', 'apng']);
    await ffmpeg('large.png', ['-f', 'lavfi', '-i', 'color=white:size=2050x2', '-frames:v', '1', '-c:v', 'png', '-threads', '1']);
    await ffmpeg('large.jpg', ['-f', 'lavfi', '-i', 'color=white:size=2050x2', '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1']);
    await ffmpeg('at-dimension-limit.png', ['-f', 'lavfi', '-i', 'color=white:size=2048x2048', '-frames:v', '1', '-c:v', 'png', '-threads', '1']);
    await ffmpeg('small.rgb', ['-f', 'lavfi', '-i', 'testsrc=size=13x11', '-frames:v', '1', '-pix_fmt', 'rgb24', '-threads', '1', '-f', 'rawvideo']);
    const png = files['avatar.png'];
    const originalChunks = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      originalChunks.push({ type: png.toString('ascii', offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + length) });
      offset += length + 12;
    }
    const compressed = Buffer.concat(originalChunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
    const raster = inflateSync(compressed);
    const replaceData = (chunks) => Buffer.concat([png.subarray(0, 8), ...originalChunks.filter((chunk) => !['IDAT', 'IEND'].includes(chunk.type)).map((chunk) => pngChunk(chunk.type, chunk.data)), ...chunks, pngChunk('IEND', Buffer.alloc(0))]);
    files['truncated-idat.png'] = replaceData([pngChunk('IDAT', compressed.subarray(0, -4))]);
    files['short-raster.png'] = replaceData([pngChunk('IDAT', deflateSync(raster.subarray(0, -1)))]);
    files['extra-raster.png'] = replaceData([pngChunk('IDAT', deflateSync(Buffer.concat([raster, Buffer.alloc(4)])))]);
    files['extra-zlib.png'] = replaceData([pngChunk('IDAT', Buffer.concat([compressed, deflateSync(Buffer.from('extra'))]))]);
    files['unknown-critical.png'] = replaceData([pngChunk('ABCD', Buffer.alloc(0)), pngChunk('IDAT', compressed)]);
    files['separated-idat.png'] = replaceData([pngChunk('IDAT', compressed.subarray(0, 32)), pngChunk('tEXt', Buffer.from('key\0value')), pngChunk('IDAT', compressed.subarray(32))]);
    const badFilter = Buffer.from(raster);
    badFilter[0] = 5;
    files['invalid-filter.png'] = replaceData([pngChunk('IDAT', deflateSync(badFilter))]);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(13, 0);
    header.writeUInt32BE(11, 4);
    header[8] = 8;
    header[9] = 2;
    header[12] = 1;
    const interlaced = [];
    for (const [x, y, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
      if (x >= 13) continue;
      for (let row = y; row < 11; row += dy) {
        interlaced.push(Buffer.from([0]));
        for (let column = x; column < 13; column += dx) interlaced.push(files['small.rgb'].subarray((row * 13 + column) * 3, (row * 13 + column + 1) * 3));
      }
    }
    files['interlaced.png'] = Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.concat(interlaced))), pngChunk('IEND', Buffer.alloc(0))]);
    const metadata = Buffer.from('private-avatar-metadata');
    const marker = Buffer.alloc(4);
    marker.writeUInt16BE(0xffef);
    marker.writeUInt16BE(metadata.length + 2, 2);
    files['metadata.jpg'] = Buffer.concat([files['avatar.jpg'].subarray(0, 2), marker, metadata, files['avatar.jpg'].subarray(2)]);
    files['concatenated.jpg'] = Buffer.concat([files['avatar.jpg'], files['avatar.jpg']]);
    files['corrupt.png'] = Buffer.from(files['avatar.png']);
    files['corrupt.png'][files['corrupt.png'].length - 20] ^= 0xff;
    files['corrupt.jpg'] = Buffer.from(files['avatar.jpg']);
    files['corrupt.jpg'].fill(0, 200, files['corrupt.jpg'].length - 2);
    files['truncated-entropy.jpg'] = Buffer.concat([files['avatar.jpg'].subarray(0, -512), files['avatar.jpg'].subarray(-2)]);
    files['truncated.mp4'] = files['valid.mp4'].subarray(0, files['valid.mp4'].length - 2000);
    files['corrupt.mp4'] = Buffer.from(files['valid.mp4']);
    const mediaOffset = files['corrupt.mp4'].indexOf(Buffer.from('mdat')) + 4;
    files['corrupt.mp4'].fill(0, mediaOffset);
    files['corrupt-tail.mp4'] = Buffer.from(files['at-limit.mp4']);
    files['corrupt-tail.mp4'].fill(0, files['corrupt-tail.mp4'].length - 1024);
    const corruptTail = join(directory, 'corrupt-tail.mp4');
    await writeFile(corruptTail, files['corrupt-tail.mp4']);
    const tailProbe = await execute('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', corruptTail], { timeout: 5000 });
    if (tailProbe.stderr.trim() || Number(JSON.parse(tailProbe.stdout).format.duration) !== 15) throw new Error('The corrupt-tail fixture must pass metadata-only probing.');
    files['scaled-matrix.mp4'] = Buffer.from(files['valid.mp4']);
    const trackHeader = files['scaled-matrix.mp4'].indexOf(Buffer.from('tkhd')) + 4;
    files['scaled-matrix.mp4'].writeInt32BE(2 * 65536, trackHeader + 40);
    files['fake-duration.mp4'] = Buffer.from(files['over-limit.mp4']);
    for (const type of ['mvhd', 'mdhd', 'tkhd']) {
      let offset = 0;
      while ((offset = files['fake-duration.mp4'].indexOf(Buffer.from(type), offset)) !== -1) {
        const payload = offset + 4;
        if (files['fake-duration.mp4'][payload] !== 0) throw new Error('Unexpected fixture box version.');
        const scale = type === 'tkhd' ? 1000 : files['fake-duration.mp4'].readUInt32BE(payload + 12);
        files['fake-duration.mp4'].writeUInt32BE(scale, payload + (type === 'tkhd' ? 20 : 16));
        offset = payload;
      }
    }
    const original = files['at-limit-600.mp4'];
    const sampleTable = original.indexOf(Buffer.from('stts')) - 4;
    const oldSize = original.readUInt32BE(sampleTable);
    if (oldSize !== 24 || original.readUInt32BE(sampleTable + 16) !== 225 || original.readUInt32BE(sampleTable + 20) !== 40 || original.indexOf(Buffer.from('moov')) < original.indexOf(Buffer.from('mdat'))) throw new Error('Unexpected sample-timing fixture layout.');
    const table = Buffer.alloc(32);
    table.writeUInt32BE(32, 0);
    table.write('stts', 4, 4, 'ascii');
    table.writeUInt32BE(2, 12);
    table.writeUInt32BE(224, 16);
    table.writeUInt32BE(40, 20);
    table.writeUInt32BE(1, 24);
    table.writeUInt32BE(100, 28);
    const fakeFinalSample = Buffer.concat([original.subarray(0, sampleTable), table, original.subarray(sampleTable + oldSize)]);
    for (const type of ['moov', 'trak', 'mdia', 'minf', 'stbl']) {
      const offset = fakeFinalSample.indexOf(Buffer.from(type)) - 4;
      fakeFinalSample.writeUInt32BE(fakeFinalSample.readUInt32BE(offset) + 8, offset);
    }
    files['fake-final-sample.mp4'] = fakeFinalSample;
    files['fake-edit-duration.mp4'] = Buffer.from(fakeFinalSample);
    const edit = files['fake-edit-duration.mp4'].indexOf(Buffer.from('elst')) + 4;
    files['fake-edit-duration.mp4'].writeUInt32BE(15_100, edit + 8);
    return files;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
