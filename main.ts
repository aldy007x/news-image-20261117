// THE WORLD ON TUESDAY 17 NOVEMBER 2026 — one image that sums up the day's world news.
//
// A make.fun "news-image-20261117" entry, v2: a full broadsheet front page. This program
// draws the whole page itself: a tiny software rasteriser, a hand-built stroke font,
// flat-colour scenes for the lead stories, and a PNG encoder on top of node:zlib.
// Node standard library only, no network, no clock, no randomness — every run writes
// exactly the same bytes to /output/entry.png.
//
// The day's stories, as reported on 17 November 2026 (Reuters, AP, BBC, CNN, the New
// York Times, Forbes, CDC/NEJM Evidence, OHCHR, UKMTO and the wires):
//   LEAD  Ukraine brings down a road span of the Crimea (Kerch) Bridge in a seven-stage
//         operation; Russia halts all traffic and strikes Kyiv's bridges in reply.
//   GULF  A fourth tanker hits a naval mine in the Strait of Hormuz, Iran's navy says;
//         UKMTO reports a projectile strike off Oman; a third US carrier is in the Gulf.
//   TECH  Nvidia's first earnings since Jensen Huang resigned beat forecasts — revenue
//         $115.8bn against $109.1bn expected — and the board will not reinstate him.
//   ASIA  Trump lands in Manila for the ASEAN-US special summit and the first Quad
//         leaders' meeting in two years; the Philippines hands the chair to Singapore.
//   PLUS  Knesset ousts Netanyahu ally Ohana as speaker (Kahana wins 66-52); 128 states
//         open "killer robot" talks in Geneva; US measles at 5,412 cases, the highest
//         since 1991; Andreeva wins the WTA Finals on debut; closing market prices;
//         Cyclone Akvan in the Bay of Bengal; and a ticker of the rest of the day.
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

function drawTextRight(
  str: string,
  xr: number,
  y: number,
  cap: number,
  col: RGB,
  opts: TextOpts = {},
): void {
  const w = textWidth(str, cap, opts.tracking ?? DEFAULT_TRACKING);
  drawText(str, xr - w, y, cap, col, opts);
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

// Greedy word wrap on the stroke font's own metrics.
function wrapText(str: string, cap: number, maxW: number, tracking: number = DEFAULT_TRACKING): string[] {
  const words = str.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const trial = line === '' ? word : line + ' ' + word;
    if (line !== '' && textWidth(trial, cap, tracking) > maxW) {
      lines.push(line);
      line = word;
    } else line = trial;
  }
  if (line !== '') lines.push(line);
  return lines;
}

// A wrapped paragraph of body copy; returns the y just past its last line.
function drawParagraph(
  str: string,
  x: number,
  y: number,
  cap: number,
  maxW: number,
  lineStep: number,
  col: RGB,
  opts: TextOpts = {},
): number {
  const lines = wrapText(str, cap, maxW, opts.tracking ?? DEFAULT_TRACKING);
  for (let i = 0; i < lines.length; i++) drawText(lines[i], x, y + i * lineStep, cap, col, opts);
  return y + lines.length * lineStep;
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
const UP: RGB = [110, 196, 120]; // gains, on the dark markets band
const DOWN: RGB = [238, 128, 116]; // losses, on the dark markets band
const BANDTXT: RGB = [214, 208, 192]; // dim text on dark bands

function rule(x1: number, x2: number, y: number, w: number, col: RGB): void {
  fillRect(x1, y - w / 2, x2 - x1, w, col);
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

// The lead scene: the Kerch bridge to Crimea with one road span down, the
// rail span beside it still standing, a missile trail arcing in.
function drawBridgeScene(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY); // sky
  fillEllipse(x + w * 0.14, y + h * 0.18, 46, 9, WHITEISH); // clouds
  fillEllipse(x + w * 0.86, y + h * 0.14, 54, 10, WHITEISH);
  fillEllipse(x + w * 0.62, y + h * 0.26, 34, 7, WHITEISH);
  const deckY = y + h * 0.5;
  const seaY = y + h * 0.68;
  fillRect(x, seaY, w, y + h - seaY, SEA); // water
  // the rail span behind, unbroken, with its arch
  fillRect(x, deckY - 16, w, 4, DARKSTEEL);
  thickLine(x + w * 0.36, deckY - 16, x + w * 0.5, deckY - 38, 3.4, DARKSTEEL);
  thickLine(x + w * 0.5, deckY - 38, x + w * 0.64, deckY - 16, 3.4, DARKSTEEL);
  for (const fx of [0.42, 0.5, 0.58]) thickLine(x + w * fx, deckY - 30 + Math.abs(fx - 0.5) * 44, x + w * fx, deckY - 16, 2, DARKSTEEL);
  // standing road decks, left and right of the gap
  fillRect(x, deckY, w * 0.4, 8, STEEL);
  fillRect(x + w * 0.6, deckY, w * 0.4, 8, STEEL);
  // the road arch over the left deck, broken off at the gap
  thickLine(x + w * 0.1, deckY, x + w * 0.24, deckY - 26, 3.4, STEEL);
  thickLine(x + w * 0.24, deckY - 26, x + w * 0.38, deckY - 4, 3.4, STEEL);
  // piers down into the water
  for (const fx of [0.07, 0.18, 0.29, 0.7, 0.81, 0.92])
    fillRect(x + w * fx, deckY + 8, 6, seaY - deckY + 5, DARKSTEEL);
  // the fallen span and its arch, tilted into the sea
  fillPoly(
    [
      [x + w * 0.435, deckY + 5],
      [x + w * 0.575, deckY + 32],
      [x + w * 0.565, deckY + 45],
      [x + w * 0.43, deckY + 18],
    ],
    DARKSTEEL,
  );
  thickLine(x + w * 0.45, deckY + 12, x + w * 0.52, deckY + 26, 3, DARKSTEEL);
  // splash where it hit the water
  fillEllipse(x + w * 0.47, seaY + 7, 20, 4.5, WHITEISH);
  fillEllipse(x + w * 0.55, seaY + 11, 14, 3.6, WHITEISH);
  // blast at the broken end of the right deck, smoke above it
  star(x + w * 0.6, deckY, 24, 10, 8, GOLD);
  fillDisc(x + w * 0.6, deckY, 8, RED);
  fillEllipse(x + w * 0.56, y + h * 0.3, 25, 11, SMOKE);
  fillEllipse(x + w * 0.62, y + h * 0.17, 18, 9, SMOKE);
  fillEllipse(x + w * 0.5, y + h * 0.4, 16, 8, SMOKE);
  // a missile trail arcing down towards the gap
  thickLine(x + w * 0.78, y + 4, x + w * 0.68, y + h * 0.24, 2.2, WHITEISH);
  thickLine(x + w * 0.68, y + h * 0.24, x + w * 0.615, y + h * 0.44, 2.2, GOLD);
  // wave dashes on the water
  for (const [fx, fy] of [
    [0.08, 0.82],
    [0.24, 0.9],
    [0.72, 0.86],
    [0.88, 0.8],
    [0.62, 0.93],
  ] as Array<[number, number]>)
    thickLine(x + w * fx, y + h * fy, x + w * fx + 20, y + h * fy, 2.2, WHITEISH);
}

// A wide, low tanker in a strait, for the Hormuz column band.
function drawTankerBand(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY);
  fillDisc(x + w * 0.88, y + h * 0.3, 9, GOLD); // low sun
  fillRect(x, y + h * 0.62, w, h * 0.38, SEA); // water
  // the strait's far shore, behind the ship
  fillPoly(
    [
      [x, y + h * 0.62],
      [x + w * 0.2, y + h * 0.4],
      [x + w * 0.34, y + h * 0.62],
    ],
    SMOKE,
  );
  const cy = y + h * 0.52;
  // hull with a red waterline
  fillPoly(
    [
      [x + w * 0.1, cy],
      [x + w * 0.9, cy],
      [x + w * 0.83, cy + 13],
      [x + w * 0.17, cy + 13],
    ],
    INK,
  );
  fillRect(x + w * 0.14, cy + 9, w * 0.72, 4, RED);
  fillRect(x + w * 0.1, cy - 4, w * 0.8, 4, STEEL); // deck
  // cargo blocks along the deck
  fillRect(x + w * 0.2, cy - 13, w * 0.13, 9, RED);
  fillRect(x + w * 0.36, cy - 13, w * 0.13, 9, NAVY);
  fillRect(x + w * 0.52, cy - 13, w * 0.11, 9, GOLD);
  // bridge tower aft, funnel forward
  fillRect(x + w * 0.78, cy - 19, w * 0.07, 15, WHITEISH);
  fillRect(x + w * 0.13, cy - 16, w * 0.045, 12, INK);
  // a mine bobbing ahead of the bow, and the strait's far shore
  fillDisc(x + w * 0.95, cy + 8, 5, INK);
  thickLine(x + w * 0.95, cy + 3, x + w * 0.95, cy - 2, 1.8, INK);
}

// An AI chip for the Nvidia column band.
function drawChipBand(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, NAVY);
  const cx = x + w / 2;
  const cy = y + h / 2;
  // pins on all four sides
  for (let i = -2; i <= 2; i++) {
    fillRect(cx + i * 13 - 2, y + 3, 4, 8, GOLD);
    fillRect(cx + i * 13 - 2, y + h - 11, 4, 8, GOLD);
    fillRect(x + 3, cy + i * 8 - 1.6, 8, 3.2, GOLD);
    fillRect(x + w - 11, cy + i * 8 - 1.6, 8, 3.2, GOLD);
  }
  // circuit traces running off the die
  thickLine(x + 8, cy - 14, cx - 34, cy - 14, 1.8, STEEL);
  thickLine(x + w - 8, cy + 12, cx + 34, cy + 12, 1.8, STEEL);
  fillDisc(x + 8, cy - 14, 2.6, GOLD);
  fillDisc(x + w - 8, cy + 12, 2.6, GOLD);
  // the die
  fillRect(cx - 30, cy - 17, 60, 34, INK);
  fillRect(cx - 30, cy - 17, 60, 2.4, GOLD);
  drawTextCentered('AI', cx, cy - 10, 19, WHITEISH, { weight: 3 });
}

// A jet airliner on finals over a runway, for the Manila column band.
function drawPlaneBand(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY);
  fillEllipse(x + w * 0.16, y + h * 0.24, 30, 6, WHITEISH);
  fillEllipse(x + w * 0.8, y + h * 0.18, 36, 6.5, WHITEISH);
  fillRect(x, y + h * 0.8, w, h * 0.2, DARKSTEEL); // runway
  for (let i = 0; i < 6; i++) fillRect(x + 14 + i * (w / 6), y + h * 0.885, 16, 2.4, WHITEISH);
  const cx = x + w * 0.52;
  const cy = y + h * 0.44;
  for (const [dx, dy] of [
    [-46, -10],
    [-50, 4],
  ] as Array<[number, number]>)
    thickLine(cx + dx, cy + dy, cx + dx + 13, cy + dy, 2, FAINT); // speed lines
  fillEllipse(cx, cy, 40, 8, NAVY); // fuselage
  fillPoly(
    [
      [cx - 4, cy + 3],
      [cx - 20, cy + 19],
      [cx + 4, cy + 19],
      [cx + 9, cy + 3],
    ],
    NAVY,
  ); // near wing
  fillPoly(
    [
      [cx - 31, cy - 3],
      [cx - 40, cy - 17],
      [cx - 28, cy - 17],
      [cx - 20, cy - 3],
    ],
    NAVY,
  ); // tail fin
  fillDisc(cx + 29, cy - 2, 2.8, WHITEISH); // cockpit glass
  thickLine(cx - 34, cy + 5.5, cx + 32, cy + 5.5, 1.8, SKY); // window line
  fillDisc(cx - 12, cy + 13, 3.4, INK); // landing gear
  fillDisc(cx + 16, cy + 13, 3.4, INK);
}

// ---------------------------------------------------------------------------
// Composition: a dense broadsheet front page.
// ---------------------------------------------------------------------------

const LX = 40; // left margin
const RX = 984; // right margin
const CW = RX - LX; // 944, content width

// One of the three illustrated columns in the second row.
function storyColumn(
  x: number,
  y: number,
  w: number,
  band: (bx: number, by: number, bw: number, bh: number) => void,
  kicker: string,
  head1: string,
  head2: string,
  summary: string,
): void {
  band(x, y, w, 46);
  fillRect(x, y, w, 1.6, INK);
  fillRect(x, y + 44.4, w, 1.6, INK);
  drawTextFitLeft(kicker, x, y + 56, 12.5, w, RED, { weight: 2.4, tracking: 0.6 });
  drawTextFitLeft(head1, x, y + 76, 20.5, w, INK, { weight: 3.1 });
  drawTextFitLeft(head2, x, y + 102, 20.5, w, INK, { weight: 3.1 });
  drawParagraph(summary, x, y + 132, 11, w, 14, INK, { weight: 1.75 });
}

// One of the four text columns in the third row.
function briefColumn(
  x: number,
  y: number,
  w: number,
  kicker: string,
  head1: string,
  head2: string,
  summary: string,
): void {
  fillRect(x, y, w, 2.2, INK);
  drawTextFitLeft(kicker, x, y + 10, 12, w, RED, { weight: 2.4, tracking: 0.6 });
  drawTextFitLeft(head1, x, y + 30, 17.5, w, INK, { weight: 2.7 });
  drawTextFitLeft(head2, x, y + 52, 17.5, w, INK, { weight: 2.7 });
  drawParagraph(summary, x, y + 78, 10.5, w, 13, INK, { weight: 1.7 });
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

  // ---- Masthead ------------------------------------------------------------
  rule(LX, RX, 40, 2, INK);
  drawText('LATE EDITION', LX, 48, 12.5, INK, { weight: 2.2, tracking: 1.2 });
  drawTextRight('SOURCES: REUTERS • AP • BBC • CNN • NYT • FORBES • CDC • OHCHR • UKMTO', RX, 48, 11.5, FAINT, {
    weight: 2,
    tracking: 1,
  });
  drawTextFit('THE WORLD IN ONE PICTURE', 512, 70, 55, 936, INK, { weight: 8, tracking: 0.4 });
  rule(LX, RX, 140, 5, INK);
  rule(LX, RX, 149, 1.5, INK);
  drawText('TUESDAY', LX, 158, 15, INK, { weight: 2.6, tracking: 1.4 });
  drawTextCentered('17 NOVEMBER 2026', 512, 156, 17.5, INK, { weight: 3.2, tracking: 1.6 });
  drawTextRight('ONE PAGE — THE WHOLE DAY', RX, 158, 15, INK, { weight: 2.6, tracking: 1.4 });

  // ---- Weather strip -------------------------------------------------------
  fillRect(LX, 182, CW, 27, MEDAL);
  rule(LX, RX, 182, 1.6, INK);
  rule(LX, RX, 209, 1.6, INK);
  drawText('WEATHER', LX + 10, 189, 13.5, RED, { weight: 2.6, tracking: 1 });
  drawTextFitLeft(
    'CYCLONE AKVAN STALLS OVER THE BAY OF BENGAL — ANDHRA PRADESH LANDFALL DUE FRIDAY • COP31 TALKS RUN ON IN ANTALYA',
    LX + 108,
    189.5,
    13,
    CW - 122,
    INK,
    { weight: 2.1 },
  );

  // ---- Lead story ----------------------------------------------------------
  drawText('EUROPE — THE WAR IN UKRAINE', LX, 222, 16.5, RED, { weight: 3, tracking: 1 });
  drawTextRight('THE LEAD STORY', RX, 222, 13, FAINT, { weight: 2.2, tracking: 1.2 });
  drawText('UKRAINE BRINGS DOWN', LX, 244, 54, INK, { weight: 7.5 });
  drawText('CRIMEA BRIDGE SPAN', LX, 306, 54, INK, { weight: 7.5 });
  drawTextFitLeft(
    "ZELENSKYY HAILS A SEVEN-STAGE 'UNPRECEDENTED OPERATION' — MOSCOW VOWS TO REBUILD IT 'BETTER THAN BEFORE'",
    LX,
    366,
    15.5,
    CW,
    INK,
    { weight: 2.4 },
  );
  rule(LX, RX, 388, 2.2, INK);
  // summary column, left
  drawParagraph(
    "KYIV — UKRAINE SAYS THE OPERATION, WEEKS IN THE MAKING, DESTROYED A METAL ARCH AND THE ROAD SPAN BENEATH IT. RUSSIA HALTED ALL TRAFFIC AND STRUCK BACK AT KYIV'S OWN BRIDGES.",
    LX,
    398,
    12.5,
    288,
    17,
    INK,
    { weight: 1.9 },
  );
  drawTextFitLeft("THE CROSSING IS 19 KM LONG — EUROPE'S LONGEST", LX, 518, 11.5, 300, RED, {
    weight: 2,
  });
  drawTextFitLeft('EVERY PICTURE ON THIS PAGE IS DRAWN IN CODE', LX, 534, 10, 300, FAINT, {
    weight: 1.8,
  });
  // scene, right, with a photo-style caption
  drawBridgeScene(352, 398, 632, 106);
  fillRect(352, 398, 632, 1.6, INK);
  fillRect(352, 502.4, 632, 1.6, INK);
  drawTextFitLeft(
    'STAFF ILLUSTRATION, AFTER SBU IMAGERY — THE FALLEN ROAD ARCH IN THE KERCH STRAIT; THE RAIL SPAN STANDS, ITS ARCH DAMAGED',
    352,
    512,
    11,
    632,
    FAINT,
    { weight: 1.8 },
  );
  rule(LX, RX, 546, 2.6, INK);

  // ---- Second row: three illustrated stories --------------------------------
  storyColumn(
    LX,
    556,
    301,
    drawTankerBand,
    'MIDDLE EAST — STRAIT OF HORMUZ',
    'FOURTH TANKER HITS',
    'A MINE IN HORMUZ',
    "IRAN'S NAVY SAYS A FOURTH TANKER HAS CAUGHT FIRE ON A NAVAL MINE. UKMTO REPORTS A PROJECTILE HIT OFF OMAN.",
  );
  storyColumn(
    361,
    556,
    301,
    drawChipBand,
    'BUSINESS — SILICON VALLEY',
    'NVIDIA BEATS BIG IN',
    'POST-HUANG REPORT',
    'FIRST EARNINGS SINCE JENSEN HUANG QUIT: REVENUE $115.8BN BEAT THE $109.1BN FORECAST. BOARD WILL NOT REINSTATE HIM.',
  );
  storyColumn(
    682,
    556,
    302,
    drawPlaneBand,
    'ASIA — ASEAN SUMMIT, MANILA',
    'TRUMP LANDS IN MANILA',
    'FOR ASEAN-US SUMMIT',
    'AIR FORCE ONE TOUCHED DOWN AT 5.33PM FOR THE ASEAN-US SPECIAL SUMMIT AND THE FIRST QUAD MEETING IN TWO YEARS.',
  );
  fillRect(344.5, 556, 1.4, 184, FAINT);
  fillRect(665.5, 556, 1.4, 184, FAINT);

  // ---- Markets box -----------------------------------------------------------
  fillRect(LX, 748, CW, 62, INK);
  drawText('MARKETS', LX + 14, 757, 13.5, GOLD, { weight: 2.8, tracking: 1.2 });
  drawTextFitLeft("TUESDAY'S CLOSE — WALL ST FALLS FOR A FOURTH DAY", LX + 122, 757, 13, PAPER, {
    weight: 2.3,
  });
  drawTextRight('NVIDIA BEAT AFTER THE BELL', RX - 14, 758, 11.5, BANDTXT, { weight: 2 });
  const cells: Array<[string, string, string, RGB]> = [
    ['S&P 500', '7,340.53', '-1.03%', DOWN],
    ['DOW JONES', '50,759.42', '-1.64%', DOWN],
    ['NASDAQ', '24,328.38', '-0.74%', DOWN],
    ['BRENT OIL', '$93.14', '+0.76%', UP],
    ['WTI OIL', '$86.01', '+0.34%', UP],
    ['GOLD', '$3,864.20', '+0.29%', UP],
  ];
  const cellW = CW / 6;
  for (let i = 0; i < cells.length; i++) {
    const cx0 = LX + i * cellW + 14;
    drawText(cells[i][0], cx0, 779, 10.5, BANDTXT, { weight: 1.9, tracking: 0.6 });
    const nw = textWidth(cells[i][0], 10.5, 0.6);
    drawText(cells[i][2], cx0 + nw + 9, 779, 10.5, cells[i][3], { weight: 2.1 });
    drawText(cells[i][1], cx0, 791, 15.5, PAPER, { weight: 2.8 });
    if (i > 0) fillRect(LX + i * cellW, 776, 1, 28, STEEL);
  }

  // ---- Third row: four brief columns -----------------------------------------
  briefColumn(
    LX,
    822,
    224,
    'ISRAEL — THE KNESSET',
    'NETANYAHU ALLY OHANA',
    'OUSTED AS SPEAKER',
    "MATAN KAHANA, OF EISENKOT'S BLOC, WINS THE CHAIR 66-52 WITH ARAB PARTIES' VOTES.",
  );
  briefColumn(
    280,
    822,
    224,
    'GENEVA — UNITED NATIONS',
    "'KILLER ROBOT' TALKS",
    'OPEN IN GENEVA',
    'DELEGATES WEIGH A TREATY BANNING LETHAL AUTONOMOUS WEAPONS. THE US, RUSSIA AND ISRAEL OPPOSE BINDING RULES.',
  );
  briefColumn(
    520,
    822,
    224,
    'UNITED STATES — HEALTH',
    'MEASLES AT HIGHEST',
    'SINCE 1991',
    '5,412 US CASES THIS YEAR, AND 13 BABIES BORN WITH MEASLES — A FIRST IN DECADES, CDC FIGURES SHOW.',
  );
  briefColumn(
    760,
    822,
    224,
    'SPORT — TENNIS AND NBA',
    'ANDREEVA TAKES WTA',
    'FINALS ON DEBUT',
    'SHE BEAT SVITOLINA 7-5 6-3. ALCARAZ AND MEDVEDEV WON IN TURIN; MITCHELL HIT 39 FOR THE CAVS.',
  );
  fillRect(264, 822, 1.4, 124, FAINT);
  fillRect(504, 822, 1.4, 124, FAINT);
  fillRect(744, 822, 1.4, 124, FAINT);

  // ---- Bottom ticker -----------------------------------------------------------
  fillRect(LX, 956, CW, 40, INK);
  drawTextFit(
    'MIDDLE EAST — IRANIAN DRONES TARGET A US RADAR IN BAHRAIN, INTERCEPTED • UK, AUSTRALIA, CANADA AND ITALY URGE ISRAEL TO OPEN GAZA CROSSINGS',
    512,
    963,
    13,
    920,
    PAPER,
    { weight: 2.2 },
  );
  drawTextFit(
    "ALSO TODAY — SUDAN: UN FINDS 1,390 CIVILIANS KILLED • FIVE EU STATES UNVEIL A RWANDA RETURN HUB • JAPAN SCRAMBLES JETS • YEMEN'S GOVERNMENT FALLS BACK ON ADEN",
    512,
    981,
    13,
    920,
    PAPER,
    { weight: 2.2 },
  );
}

function main(): void {
  compose();
  const png = encodePNG(W, H, downsample());
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
