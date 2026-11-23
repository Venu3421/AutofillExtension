import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Creates a valid PNG buffer using Node's built-in zlib.
 * Generates an iconic saffron/blue temple & lightning glyph.
 */
function createPng(size) {
  // RGBA buffer (4 bytes per pixel)
  const width = size;
  const height = size;
  const buffer = Buffer.alloc(width * height * 4);

  // Background color: Saffron/Gold (#d97706) for TTD theme
  // Border: Dark Blue (#1e3a8a)
  // Center: White/Gold symbol
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = width / 2 - 1;

      if (dist <= radius) {
        // Inner circle: Saffron gradient
        const t = y / height;
        buffer[idx] = Math.floor(245 - t * 30);     // R (245 -> 215)
        buffer[idx + 1] = Math.floor(158 - t * 40); // G (158 -> 118)
        buffer[idx + 2] = Math.floor(11);          // B (11)
        buffer[idx + 3] = 255;                     // Alpha

        // Temple dome / triangle shape in center
        const inCenter = Math.abs(dx) <= (height * 0.4 - Math.abs(dy)) * 0.8;
        if (inCenter && dy > -height * 0.35 && dy < height * 0.35) {
          buffer[idx] = 255;
          buffer[idx + 1] = 255;
          buffer[idx + 2] = 255;
          buffer[idx + 3] = 255;
        }

        // Lightning bolt overlay in center
        const inBolt = (dx > -width * 0.15 && dx < width * 0.15 && Math.abs(dx + dy * 0.3) < width * 0.08);
        if (inBolt) {
          buffer[idx] = 37;
          buffer[idx + 1] = 99;
          buffer[idx + 2] = 235; // Blue
          buffer[idx + 3] = 255;
        }
      } else {
        // Transparent outside
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  // Construct PNG chunks: Signature, IHDR, IDAT, IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0; // filter byte
    buffer.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  // IDAT chunk
  const compressed = zlib.deflateSync(scanlines);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(len + 12);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, len + 8));
  chunk.writeUInt32BE(crc, len + 8);
  return chunk;
}

// CRC32 implementation
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return (crc ^ -1) >>> 0;
}

// Ensure icon directories exist
const publicIconsDir = path.resolve('public/icons');
const distIconsDir = path.resolve('dist/icons');
fs.mkdirSync(publicIconsDir, { recursive: true });
fs.mkdirSync(distIconsDir, { recursive: true });

[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size);
  const fileName = `icon-${size}.png`;
  fs.writeFileSync(path.join(publicIconsDir, fileName), pngBuf);
  fs.writeFileSync(path.join(distIconsDir, fileName), pngBuf);
  console.log(`Generated ${fileName} (${pngBuf.length} bytes)`);
});
