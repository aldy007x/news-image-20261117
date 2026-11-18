// THE WORLD ON TUESDAY 17 NOVEMBER 2026 — one image that sums up the day's world news.
//
// A make.fun "news-image-20261117" entry. This program draws the whole front page itself:
// a tiny software rasteriser, a hand-built stroke font, flat-colour scenes for each story,
// and a PNG encoder on top of node:zlib. Node standard library only, no network, no clock,
// no randomness — every run writes exactly the same bytes to /output/entry.png.
//
// Run locally with:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG encoder (8-bit RGB, filter 0 scanlines, zlib via node:zlib)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Raster canvas. The page is designed on a 1024x1024 grid and drawn at 2x,
// then box-downsampled, which anti-aliases every edge and stroke.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

const SS = 2; // supersample factor
const W = 1024;
const H = 1024;
const IW = W * SS;
const IH = H * SS;
const pixels = new Uint8Array(IW * IH * 3);

function setPx(x: number, y: number, col: RGB): void {
  if (x < 0 || y < 0 || x >= IW || y >= IH) return;
  const i = (y * IW + x) * 3;
  pixels[i] = col[0];
  pixels[i + 1] = col[1];
  pixels[i + 2] = col[2];
}

function fillRect(x: number, y: number, w: number, h: number, col: RGB): void {
  const x0 = Math.max(0, Math.round(x * SS));
  const y0 = Math.max(0, Math.round(y * SS));
  const x1 = Math.min(IW, Math.round((x + w) * SS));
  const y1 = Math.min(IH, Math.round((y + h) * SS));
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, col);
}

function fillDisc(cx: number, cy: number, r: number, col: RGB): void {
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rr = r * SS;
  const x0 = Math.floor(ccx - rr);
  const x1 = Math.ceil(ccx + rr);
  const y0 = Math.floor(ccy - rr);
  const y1 = Math.ceil(ccy + rr);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - ccx;
      const dy = yy - ccy;
      if (dx * dx + dy * dy <= rr * rr) setPx(xx, yy, col);
    }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, col: RGB): void {
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rrx = rx * SS;
  const rry = ry * SS;
  const x0 = Math.floor(ccx - rrx);
  const x1 = Math.ceil(ccx + rrx);
  const y0 = Math.floor(ccy - rry);
  const y1 = Math.ceil(ccy + rry);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const dx = (xx - ccx) / rrx;
      const dy = (yy - ccy) / rry;
      if (dx * dx + dy * dy <= 1) setPx(xx, yy, col);
    }
}

// A thick line is a row of stamped discs, which gives round caps and joins.
function thickLine(x1: number, y1: number, x2: number, y2: number, w: number, col: RGB): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.6, w * 0.22)));
  for (let i = 0; i <= steps; i++)
    fillDisc(x1 + (dx * i) / steps, y1 + (dy * i) / steps, w / 2, col);
}

function strokeCircle(cx: number, cy: number, r: number, w: number, col: RGB): void {
  const steps = Math.max(24, Math.ceil((2 * Math.PI * r) / Math.max(0.6, w * 0.22)));
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    fillDisc(cx + r * Math.cos(a), cy + r * Math.sin(a), w / 2, col);
  }
}

function fillPoly(pts: Array<[number, number]>, col: RGB): void {
  const p = pts.map((q) => [q[0] * SS, q[1] * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of p) {
    minY = Math.min(minY, q[1]);
    maxY = Math.max(maxY, q[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(IH - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i]));
      const xb = Math.min(IW - 1, Math.round(xs[i + 1]));
      for (let x = xa; x <= xb; x++) setPx(x, y, col);
    }
  }
}

function downsample(): Buffer {
  const out = Buffer.alloc(W * H * 3);
  const n = SS * SS;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++)
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * IW + (x * SS + dx)) * 3;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
        }
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  return out;
}

// ---------------------------------------------------------------------------
// Stroke font. Each glyph is a set of polylines on a 0..8 wide, 0..12 tall
// grid (cap height 12, baseline at 12). Strokes are separated by ';' and
// points are 'x,y' pairs. A one-point stroke stamps a single dot.
// ---------------------------------------------------------------------------

const GLYPH_SRC: Record<string, string> = {
  A: '0,12 4,0 8,12;1.4,7.2 6.6,7.2',
  B: '0,0 0,12;0,0 4.6,0 6.4,1.4 6.4,3.8 4.6,5.6 0,5.6;0,5.6 5.2,5.6 7,7.2 7,9.8 5.2,12 0,12',
  C: '7.2,2.4 5.4,0.4 3,0 1.2,1.2 0.2,3.4 0.2,8.6 1.2,10.8 3,12 5.4,11.6 7.2,9.6',
  D: '0,0 0,12;0,0 4.2,0 6.6,2.2 7.4,6 6.6,9.8 4.2,12 0,12',
  E: '7,0 0,0 0,12 7,12;0,6 5.4,6',
  F: '7,0 0,0 0,12;0,6 5.2,6',
  G: '7.2,2.4 5.4,0.4 3,0 1.2,1.2 0.2,3.4 0.2,8.6 1.2,10.8 3,12 5.6,11.7 7.6,10.2 7.6,6.8 4.6,6.8',
  H: '0,0 0,12;8,0 8,12;0,6 8,6',
  I: '4,0 4,12;1.2,0 6.8,0;1.2,12 6.8,12',
  J: '7.4,0 7.4,8.8 6.2,11 4,12 1.8,11.4 0.6,9.6',
  K: '0,0 0,12;7.2,0 0.8,6.6;2,5.4 7.4,12',
  L: '0,0 0,12 7,12',
  M: '0,12 0,0 4,6.8 8,0 8,12',
  N: '0,12 0,0 8,12 8,0',
  O: '4,0 6.4,0.8 7.8,3 7.8,9 6.4,11.2 4,12 1.6,11.2 0.2,9 0.2,3 1.6,0.8 4,0',
  P: '0,12 0,0 4.8,0 6.8,1.6 6.8,4.4 4.8,6 0,6',
  Q: '4,0 6.4,0.8 7.8,3 7.8,9 6.4,11.2 4,12 1.6,11.2 0.2,9 0.2,3 1.6,0.8 4,0;5.2,8.8 8,12',
  R: '0,12 0,0 4.8,0 6.8,1.6 6.8,4.4 4.8,6 0,6;3.6,6 7.2,12',
  S: '7,1.8 5.2,0.2 2.8,0.2 1,1.6 1.2,3.8 3,5.2 5.4,6.4 6.8,8.2 6.6,10.4 4.8,11.8 2.2,11.8 0.6,10.2',
  T: '0,0 8,0;4,0 4,12',
  U: '0,0 0,8.4 1,10.8 3,12 5,12 7,10.8 8,8.4 8,0',
  V: '0,0 4,12 8,0',
  W: '0,0 1.7,12 4,4.6 6.3,12 8,0',
  X: '0,0 8,12;8,0 0,12',
  Y: '0,0 4,5.6 8,0;4,5.6 4,12',
  Z: '0,0 8,0 0,12 8,12',
  '0': '4,0 5.9,0.8 6.9,2.8 6.9,9.2 5.9,11.2 4,12 2.1,11.2 1.1,9.2 1.1,2.8 2.1,0.8 4,0',
  '1': '2.2,2.6 4.6,0 4.6,12;1.4,12 7,12',
  '2': '0.8,2.4 2.2,0.4 5.2,0.2 6.8,2 6.4,4.6 0.6,12 7.2,12',
  '3': '0.8,1.8 2.6,0.2 5.2,0.4 6.6,2.2 6,4.6 4,5.8 2.6,5.8;4,5.8 6.2,7 6.6,9.4 5.2,11.6 2.4,11.9 0.8,10.4',
  '4': '5.6,12 5.6,0 0.4,8.6 8,8.6',
  '5': '7,0 1.2,0 1.2,4.8 4.2,4.4 6.4,6 6.8,8.8 5.4,11.4 2.6,11.9 0.8,10.6',
  '6': '6.4,1.6 4.2,0.2 1.8,1.8 0.6,5 0.8,9 2,11.2 4.2,12 6.2,10.8 7,9 6.4,6.4 4.4,5.4 2.2,6 1,7.8',
  '7': '0.4,0 7.6,0 3.4,12',
  '8': '4,5.8 2.2,5 1.4,3.4 2,1.2 4,0.2 6,1.2 6.6,3.4 5.8,5 4,5.8;4,5.8 1.8,6.8 1,9 2.2,11.4 4,12 5.8,11.4 7,9 6.2,6.8 4,5.8',
  '9': '1.6,10.4 3.8,11.8 6.2,10.2 7.4,7 7.2,3 6,0.8 3.8,0 1.8,1.2 1,3.4 1.8,6 3.8,6.8 6,6 7,4.4',
  '.': '4,11.2',
  ',': '4,11;4.9,10.8 4,13',
  "'": '4.4,0 3.6,2.6',
  '-': '1.4,6 6.6,6',
  ':': '4,3.2;4,8.8',
  ';': '4,3.2;4,8.6;4.9,8.4 4,11',
  '!': '4,0 4,8.2;4,11.2',
  '?': '1,2.2 2.4,0.4 5.4,0.3 6.9,1.9 6.4,4.2 4.2,6 4.2,8.6;4.2,11.2',
  '/': '6.4,0 1.6,12',
  '(': '6.4,0.6 3.4,2.4 2.2,6 3.4,9.6 6.4,11.4',
  ')': '1.6,0.6 4.6,2.4 5.8,6 4.6,9.6 1.6,11.4',
  '%': '2.2,1 3.4,1.6 3.2,3.4 1.6,3.8 0.6,2.8 1,1.2 2.2,1;6.8,0.6 1.2,11.4;5.8,8.2 7,8.8 6.8,10.6 5.2,11 4.2,10 4.6,8.4 5.8,8.2',
  '+': '4,3 4,9;1,6 7,6',
  '"': '2.6,0 2.2,2.4;5.8,0 5.4,2.4',
  '•': '4,6',
  $: '7,1.8 5.2,0.2 2.8,0.2 1,1.6 1.2,3.8 3,5.2 5.4,6.4 6.8,8.2 6.6,10.4 4.8,11.8 2.2,11.8 0.6,10.2;4,0 4,12',
  '—': '0.4,6 7.6,6',
  '–': '1,6 7,6',
  '…': '1.6,11.2;4,11.2;6.4,11.2',
  '=': '1,4.4 7,4.4;1,7.6 7,7.6',
};

type Stroke = Array<[number, number]>;
const GLYPHS: Record<string, Stroke[]> = {};
for (const key of Object.keys(GLYPH_SRC))
  GLYPHS[key] = GLYPH_SRC[key]
    .split(';')
    .map((s) => s.trim().split(' ').map((p) => p.split(',').map(Number) as [number, number]));

interface TextOpts {
  weight?: number; // stroke width in px; defaults to a proportion of cap height
  tracking?: number; // extra advance per glyph, in grid units
}

const DEFAULT_TRACKING = 0.7;

function textWidth(str: string, cap: number, tracking: number = DEFAULT_TRACKING): number {
  const u = cap / 12;
  let w = 0;
  for (const ch of str) w += (ch === ' ' ? 5 : 8 + tracking) * u;
  return w;
}

function drawText(
  str: string,
  x: number,
  y: number,
  cap: number,
  col: RGB,
  opts: TextOpts = {},
): number {
  const weight = opts.weight ?? cap * 0.115;
  const tracking = opts.tracking ?? DEFAULT_TRACKING;
  const u = cap / 12;
  let cx = x;
  for (const raw of str) {
    const ch = raw.toUpperCase();
    if (ch === ' ') {
      cx += 5 * u;
      continue;
    }
    const glyph = GLYPHS[ch];
    if (glyph)
      for (const stroke of glyph) {
        if (stroke.length === 1)
          fillDisc(cx + stroke[0][0] * u, y + stroke[0][1] * u, weight / 2, col);
        else
          for (let i = 0; i + 1 < stroke.length; i++)
            thickLine(
              cx + stroke[i][0] * u,
              y + stroke[i][1] * u,
              cx + stroke[i + 1][0] * u,
              y + stroke[i + 1][1] * u,
              weight,
              col,
            );
      }
    cx += (8 + tracking) * u;
  }
  return cx - x;
}

function drawTextCentered(
  str: string,
  cx: number,
  y: number,
  cap: number,
  col: RGB,
  opts: TextOpts = {},
): void {
  const w = textWidth(str, cap, opts.tracking ?? DEFAULT_TRACKING);
  drawText(str, cx - w / 2, y, cap, col, opts);
}

// Draw centred text, shrinking the cap height until it fits maxW.
function drawTextFit(
  str: string,
  cx: number,
  y: number,
  cap: number,
  maxW: number,
  col: RGB,
  opts: TextOpts = {},
): void {
  const w = textWidth(str, cap, opts.tracking ?? DEFAULT_TRACKING);
  const useCap = w > maxW ? (cap * maxW) / w : cap;
  drawTextCentered(str, cx, y, useCap, col, opts);
}

// ---------------------------------------------------------------------------
// Palette and page furniture
// ---------------------------------------------------------------------------

const PAPER: RGB = [247, 242, 231];
const INK: RGB = [20, 22, 26];
const RED: RGB = [178, 34, 27];
const NAVY: RGB = [29, 58, 95];
const SEA: RGB = [36, 78, 118];
const SKY: RGB = [203, 218, 231];
const GOLD: RGB = [216, 158, 44];
const SMOKE: RGB = [148, 148, 146];
const STEEL: RGB = [88, 92, 100];
const DARKSTEEL: RGB = [64, 68, 76];
const MEDAL: RGB = [233, 226, 208];
const WHITEISH: RGB = [243, 244, 240];
const FAINT: RGB = [120, 116, 104];

function rule(x1: number, x2: number, y: number, w: number, col: RGB): void {
  fillRect(x1, y - w / 2, x2 - x1, w, col);
}

// Left-aligned text that shrinks its cap height until it fits maxW.
function drawTextFitLeft(
  str: string,
  x: number,
  y: number,
  cap: number,
  maxW: number,
  col: RGB,
  opts: TextOpts = {},
): void {
  const w = textWidth(str, cap, opts.tracking ?? DEFAULT_TRACKING);
  const useCap = w > maxW ? (cap * maxW) / w : cap;
  drawText(str, x, y, useCap, col, opts);
}

function star(cx: number, cy: number, rOuter: number, rInner: number, n: number, col: RGB): void {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  fillPoly(pts, col);
}

// ---------------------------------------------------------------------------
// Scenes. Every picture is flat shapes in the palette: no photos, no assets.
// ---------------------------------------------------------------------------

// The lead scene: the Kerch bridge to Crimea with one road span down.
function drawBridgeScene(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY); // sky
  fillEllipse(x + w * 0.16, y + h * 0.2, 44, 10, WHITEISH); // clouds
  fillEllipse(x + w * 0.85, y + h * 0.16, 52, 11, WHITEISH);
  const deckY = y + h * 0.52;
  const seaY = y + h * 0.68;
  fillRect(x, seaY, w, y + h - seaY, SEA); // water
  // standing decks, left and right of the gap
  fillRect(x, deckY, w * 0.4, 9, STEEL);
  fillRect(x + w * 0.6, deckY, w * 0.4, 9, STEEL);
  // piers down into the water
  for (const fx of [0.08, 0.2, 0.32, 0.68, 0.8, 0.92])
    fillRect(x + w * fx, deckY + 9, 7, seaY - deckY + 6, DARKSTEEL);
  // the fallen span, tilted into the sea
  fillPoly(
    [
      [x + w * 0.44, deckY + 6],
      [x + w * 0.575, deckY + 34],
      [x + w * 0.565, deckY + 48],
      [x + w * 0.435, deckY + 20],
    ],
    DARKSTEEL,
  );
  // splash where it hit the water
  fillEllipse(x + w * 0.47, seaY + 8, 20, 5, WHITEISH);
  fillEllipse(x + w * 0.55, seaY + 12, 14, 4, WHITEISH);
  // blast at the broken end of the right deck, smoke above it
  star(x + w * 0.6, deckY, 27, 11, 8, GOLD);
  fillDisc(x + w * 0.6, deckY, 9, RED);
  fillEllipse(x + w * 0.55, y + h * 0.3, 27, 13, SMOKE);
  fillEllipse(x + w * 0.6, y + h * 0.18, 20, 10, SMOKE);
  fillEllipse(x + w * 0.5, y + h * 0.4, 18, 9, SMOKE);
  // wave dashes on the water
  for (const [fx, fy] of [
    [0.1, 0.8],
    [0.26, 0.88],
    [0.72, 0.84],
    [0.88, 0.78],
    [0.62, 0.92],
  ] as Array<[number, number]>)
    thickLine(x + w * fx, y + h * fy, x + w * fx + 22, y + h * fy, 2.4, WHITEISH);
}

// An oil tanker in a strait (Strait of Hormuz panel).
function drawTanker(cx: number, cy: number): void {
  fillDisc(cx - 25, cy - 26, 9, GOLD); // low sun
  // hull with a red waterline
  fillPoly(
    [
      [cx - 35, cy + 6],
      [cx + 35, cy + 6],
      [cx + 26, cy + 21],
      [cx - 26, cy + 21],
    ],
    INK,
  );
  fillRect(cx - 29, cy + 16, 58, 5, RED);
  fillRect(cx - 35, cy + 2, 70, 4, STEEL); // deck
  // cargo blocks along the deck
  fillRect(cx - 20, cy - 6, 13, 8, RED);
  fillRect(cx - 5, cy - 6, 13, 8, NAVY);
  fillRect(cx + 10, cy - 6, 11, 8, GOLD);
  // bridge tower and funnel aft
  fillRect(cx + 24, cy - 14, 9, 16, WHITEISH);
  fillRect(cx - 31, cy - 11, 6, 13, INK);
  // waves
  thickLine(cx - 36, cy + 29, cx - 14, cy + 26, 2.4, NAVY);
  thickLine(cx - 10, cy + 30, cx + 12, cy + 27, 2.4, NAVY);
  thickLine(cx + 16, cy + 29, cx + 36, cy + 26, 2.4, NAVY);
}

// A jet airliner climbing (Trump's arrival in Manila panel).
function drawPlane(cx: number, cy: number): void {
  fillDisc(cx + 24, cy - 22, 10, GOLD); // sun
  for (const [dx, dy] of [
    [-38, -14],
    [-42, 2],
    [-38, 18],
  ] as Array<[number, number]>)
    thickLine(cx + dx, cy + dy, cx + dx + 12, cy + dy, 2.2, FAINT); // speed lines
  fillEllipse(cx, cy, 33, 7.5, NAVY); // fuselage
  fillPoly(
    [
      [cx - 4, cy + 3],
      [cx - 18, cy + 20],
      [cx + 3, cy + 20],
      [cx + 8, cy + 3],
    ],
    NAVY,
  ); // near wing
  fillPoly(
    [
      [cx - 27, cy - 3],
      [cx - 35, cy - 16],
      [cx - 24, cy - 16],
      [cx - 17, cy - 3],
    ],
    NAVY,
  ); // tail fin
  fillDisc(cx + 24, cy - 2, 2.6, SKY); // cockpit glass
  thickLine(cx - 30, cy + 6, cx + 28, cy + 6, 1.8, SKY); // window line
}

// A parliament house (Knesset panel).
function drawParliament(cx: number, cy: number): void {
  thickLine(cx, cy - 26, cx, cy - 40, 2.4, INK); // flagpole
  fillPoly(
    [
      [cx, cy - 40],
      [cx + 13, cy - 36.5],
      [cx, cy - 33],
    ],
    RED,
  ); // flag
  fillPoly(
    [
      [cx - 33, cy - 10],
      [cx + 33, cy - 10],
      [cx, cy - 27],
    ],
    INK,
  ); // pediment
  fillRect(cx - 33, cy - 9, 66, 5, INK); // entablature
  for (const dx of [-27, -10, 7, 24]) fillRect(cx + dx, cy - 3, 5.5, 25, INK); // columns
  fillRect(cx - 35, cy + 22, 70, 5, INK); // steps
}

// A robot head inside a ring (Geneva autonomous-weapons talks panel).
function drawRobot(cx: number, cy: number): void {
  strokeCircle(cx, cy, 41, 2.6, NAVY); // the ring of nations
  thickLine(cx, cy - 15, cx, cy - 27, 3, NAVY); // antenna
  fillDisc(cx, cy - 30, 4.2, RED);
  fillRect(cx - 21, cy - 15, 42, 34, NAVY); // head
  fillRect(cx - 26, cy - 6, 5, 14, NAVY); // ears
  fillRect(cx + 21, cy - 6, 5, 14, NAVY);
  fillDisc(cx - 9, cy - 2, 4.6, WHITEISH); // eyes
  fillDisc(cx + 9, cy - 2, 4.6, WHITEISH);
  for (const dx of [-9, 0, 9]) thickLine(cx + dx, cy + 8, cx + dx, cy + 14, 2.4, GOLD); // grille
  fillRect(cx - 7, cy + 19, 14, 5, NAVY); // neck
}

// ---------------------------------------------------------------------------
// Composition: masthead, one lead story, four panels, a ticker, a footer.
// ---------------------------------------------------------------------------

function panel(
  px: number,
  py: number,
  kicker: string,
  head1: string,
  head2: string,
  dek: string,
  icon: (cx: number, cy: number) => void,
): void {
  fillDisc(px + 52, py + 52, 47, MEDAL);
  strokeCircle(px + 52, py + 52, 47, 2, INK);
  icon(px + 52, py + 52);
  const tx = px + 112;
  drawTextFitLeft(kicker, tx, py + 0, 15.5, 344, RED, { weight: 2.6, tracking: 0.9 });
  drawTextFitLeft(head1, tx, py + 25, 27, 344, INK, { weight: 3.6 });
  drawTextFitLeft(head2, tx, py + 61, 27, 344, INK, { weight: 3.6 });
  drawTextFitLeft(dek, tx, py + 104, 15.5, 344, INK, { weight: 2.1 });
}

function compose(): void {
  fillRect(0, 0, W, H, PAPER);
  // double frame
  fillRect(17, 17, W - 34, 3, INK);
  fillRect(17, H - 20, W - 34, 3, INK);
  fillRect(17, 17, 3, H - 34, INK);
  fillRect(W - 20, 17, 3, H - 34, INK);
  fillRect(25, 25, W - 50, 1.2, INK);
  fillRect(25, H - 26.2, W - 50, 1.2, INK);
  fillRect(25, 25, 1.2, H - 50, INK);
  fillRect(W - 26.2, 25, 1.2, H - 50, INK);

  // Masthead: the date is the biggest thing on the page.
  rule(44, 980, 38, 2, INK);
  drawTextCentered("THE WORLD IN ONE PICTURE", 512, 46, 19, INK, { weight: 2.6, tracking: 2.4 });
  drawTextCentered("17 NOVEMBER 2026", 512, 86, 72, INK, { weight: 11 });
  rule(44, 980, 168, 5, INK);
  rule(44, 980, 178, 1.5, INK);
  drawTextCentered("TUESDAY — THE WHOLE DAY, ON ONE PAGE", 512, 188, 16, FAINT, {
    weight: 2.2,
    tracking: 1.6,
  });

  // Lead story: Ukraine brings down a span of the Crimea bridge.
  drawText("EUROPE • THE WAR IN UKRAINE", 44, 220, 21, RED, { weight: 3.4, tracking: 1 });
  drawText("UKRAINE BRINGS DOWN", 44, 250, 52, INK, { weight: 7 });
  drawText("CRIMEA BRIDGE SPAN", 44, 316, 52, INK, { weight: 7 });
  drawBridgeScene(44, 384, 936, 108);
  drawTextFit(
    "ZELENSKYY HAILS AN 'UNPRECEDENTED OPERATION' — RUSSIA ANSWERS ON KYIV'S BRIDGES",
    512,
    504,
    18,
    930,
    INK,
    { weight: 2.5 },
  );
  rule(44, 980, 542, 2.5, INK);

  // Four panels: Middle East, Asia, Israel, Geneva.
  panel(44, 558, "MIDDLE EAST • STRAIT OF HORMUZ", "TANKERS HIT MINES", "IN HORMUZ, IRAN SAYS", "THIRD US CARRIER IN THE GULF", drawTanker);
  panel(524, 558, "ASIA • ASEAN SUMMIT, MANILA", "TRUMP IN MANILA", "FOR ASEAN SUMMIT", "SIGNS THAI TRADE STATEMENT", drawPlane);
  panel(44, 724, "ISRAEL • THE KNESSET", "NETANYAHU ALLY OUSTED", "AS KNESSET SPEAKER", "EISENKOT BLOC WINS 66-52", drawParliament);
  panel(524, 724, "GENEVA • UNITED NATIONS", "'KILLER ROBOT' TALKS", "OPEN IN GENEVA", "128 NATIONS WEIGH A BAN", drawRobot);
  fillRect(511, 558, 1.6, 310, FAINT); // column divider
  rule(44, 980, 711, 1.6, FAINT); // row divider

  // Ticker: the rest of the day in two lines.
  fillRect(44, 884, 936, 62, INK);
  drawTextCentered("ALSO TODAY — NVIDIA'S FIRST EARNINGS SINCE HUANG EXIT", 512, 893, 16.5, PAPER, {
    weight: 2.4,
  });
  drawTextCentered("JAPAN JETS SCRAMBLE • COP31 ANTALYA • MEASLES HIGHEST SINCE 1991", 512, 920, 16.5, PAPER, {
    weight: 2.4,
  });

  drawTextCentered("TUESDAY 17 NOVEMBER 2026 — THE DAY AS REPORTED AROUND THE WORLD", 512, 962, 15, FAINT, {
    weight: 2.1,
    tracking: 1.2,
  });
}

function main(): void {
  compose();
  const png = encodePNG(W, H, downsample());
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
