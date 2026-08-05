'use strict';

/**
 * Generates transparent PNG signatures (handwriting-style strokes)
 * using pure Node.js (no canvas native deps).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

const SIGNATURES_DIR = path.join(__dirname, '..', 'data', 'signatures');
const META_PATH = path.join(SIGNATURES_DIR, 'index.json');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, paintFn) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = 0;
  }

  paintFn(pixels, width, height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, width, height, x, y, r, g, b, a) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
  const i = (yi * width + xi) * 4;
  const outA = a / 255;
  const inA = pixels[i + 3] / 255;
  const out = outA + inA * (1 - outA);
  if (out <= 0) return;
  pixels[i] = Math.round((r * outA + pixels[i] * inA * (1 - outA)) / out);
  pixels[i + 1] = Math.round((g * outA + pixels[i + 1] * inA * (1 - outA)) / out);
  pixels[i + 2] = Math.round((b * outA + pixels[i + 2] * inA * (1 - outA)) / out);
  pixels[i + 3] = Math.round(out * 255);
}

function drawBrush(pixels, width, height, x, y, radius, color) {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const alpha = Math.round(color.a * (1 - dist / radius));
      setPixel(pixels, width, height, x + dx, y + dy, color.r, color.g, color.b, alpha);
    }
  }
}

function strokePath(pixels, width, height, points, radius, color) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      drawBrush(pixels, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
    }
  }
}

const INK = { r: 18, g: 42, b: 78, a: 230 };
const INK_TEAL = { r: 20, g: 90, b: 85, a: 235 };
const INK_SLATE = { r: 45, g: 55, b: 72, a: 225 };

const PREDEFINED = [
  {
    name: 'Alex Rivera',
    color: INK,
    paths: [
      [
        [40, 110],
        [55, 70],
        [70, 130],
        [85, 55],
        [100, 125],
        [115, 80],
      ],
      [
        [130, 100],
        [160, 60],
        [200, 95],
        [240, 70],
        [280, 105],
        [320, 75],
        [360, 100],
      ],
      [
        [200, 140],
        [250, 145],
        [300, 138],
      ],
    ],
  },
  {
    name: 'Jordan Lee',
    color: INK_TEAL,
    paths: [
      [
        [50, 120],
        [70, 50],
        [90, 120],
      ],
      [
        [105, 90],
        [130, 55],
        [170, 100],
        [210, 65],
        [250, 110],
        [290, 70],
        [340, 95],
      ],
      [
        [160, 130],
        [280, 135],
      ],
    ],
  },
  {
    name: 'Sam Patel',
    color: INK_SLATE,
    paths: [
      [
        [45, 100],
        [80, 55],
        [100, 115],
        [120, 70],
      ],
      [
        [140, 95],
        [180, 60],
        [220, 105],
        [270, 55],
        [320, 100],
        [360, 80],
      ],
      [
        [150, 140],
        [220, 148],
        [300, 140],
      ],
    ],
  },
  {
    name: 'Casey Morgan',
    color: INK,
    paths: [
      [
        [40, 80],
        [70, 50],
        [95, 120],
        [115, 55],
        [140, 110],
      ],
      [
        [160, 85],
        [200, 55],
        [250, 100],
        [300, 60],
        [350, 95],
      ],
      [
        [180, 135],
        [320, 140],
      ],
    ],
  },
];

function main() {
  fs.mkdirSync(SIGNATURES_DIR, { recursive: true });

  let existing = [];
  if (fs.existsSync(META_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    } catch {
      existing = [];
    }
  }

  const custom = existing.filter((s) => !s.predefined);
  for (const item of existing.filter((s) => s.predefined)) {
    const p = path.join(SIGNATURES_DIR, item.id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const width = 400;
  const height = 180;
  const predefined = PREDEFINED.map((sig) => {
    const id = `${uuidv4()}.png`;
    const png = createPng(width, height, (pixels, w, h) => {
      for (const pathPts of sig.paths) {
        strokePath(pixels, w, h, pathPts, 3.2, sig.color);
      }
    });
    fs.writeFileSync(path.join(SIGNATURES_DIR, id), png);
    return {
      id,
      name: sig.name,
      mimeType: 'image/png',
      predefined: true,
      createdAt: new Date().toISOString(),
    };
  });

  const meta = [...predefined, ...custom];
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  console.log(`Seeded ${predefined.length} predefined signatures (${custom.length} custom kept).`);
}

main();
