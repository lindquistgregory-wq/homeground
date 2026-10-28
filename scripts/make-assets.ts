/**
 * Renders the app icon, splash image and Play Store graphics from the vector sources in
 * apps/mobile/assets/src (dev only; uses @resvg/resvg-js). Run: pnpm tsx scripts/make-assets.ts
 * Store screenshots (optional): pass a folder OUTSIDE the repo, e.g. --shots C:/Users/me/Documents/store, holding
 * raw/<name>.png phone screenshots (1080 × 2340). They are framed with a caption to 1080 × 1920 (Play allows at
 * most 2:1) in <folder>/screenshots. Screenshots show a real property, so they are never written into the repo.
 */
import { Resvg } from '@resvg/resvg-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/mobile/assets/src');
const OUT = join(ROOT, 'apps/mobile/assets');
const STORE = join(ROOT, 'docs/store');
const FONTS = [
  ...['400Regular/Inter_400Regular.ttf', '700Bold/Inter_700Bold.ttf'].map((f) => join(ROOT, 'node_modules/@expo-google-fonts/inter', f)),
  join(ROOT, 'node_modules/@expo-google-fonts/bitter/700Bold/Bitter_700Bold.ttf'),
];

const COLOURS = { SUN: '#ffcf5a', FIELD1: '#b7e08a', FIELD2: '#8cc46f', FURROW: '#6fa84c', STEM: '#f7f3e3', LEAF1: '#f7f3e3', LEAF2: '#ffffff', VEIN: '#cfe6b8' };
const MONO = { SUN: '#ffffff', FIELD1: '#ffffff', FIELD2: '#ffffff', FURROW: '#000000', STEM: '#ffffff', LEAF1: '#ffffff', LEAF2: '#ffffff', VEIN: '#000000' };
const BG = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f8f35"/><stop offset="1" stop-color="#1f5a24"/></linearGradient></defs>`;

const mark = (colours: Record<string, string>) =>
  Object.entries(colours).reduce((s, [k, v]) => s.replaceAll(`"${k}"`, `"${v}"`), readFileSync(join(SRC, 'mark.svg.part'), 'utf8'))
    // Monochrome icons are silhouettes: furrow and vein lines become cut-outs rather than black ink.
    .replace(/<path[^>]*stroke="#000000"[^>]*\/>/g, '');

function png(svg: string, width: number, file: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } });
  writeFileSync(file, r.render().asPng());
  console.log('wrote', file.replace(ROOT, '.'));
}

const square = (inner: string, rx = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${BG}<rect width="1024" height="1024" rx="${rx}" fill="url(#bg)"/>${inner}</svg>`;

// App icon (full bleed; the OS applies its own mask), adaptive foreground and monochrome, splash.
png(square(mark(COLOURS)), 1024, join(OUT, 'icon.png'));
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${mark(COLOURS)}</svg>`, 1024, join(OUT, 'adaptive-icon.png'));
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${mark(MONO)}</svg>`, 1024, join(OUT, 'adaptive-mono.png'));
// The splash shows the mark (adaptive-icon.png) on the brand green; see app.json.

// Play Store: 512 px icon.
mkdirSync(STORE, { recursive: true });
png(square(mark(COLOURS)), 512, join(STORE, 'icon-512.png'));
// The 1024 × 500 feature graphic is drawn by scripts/make-feature-graphic.ts.

// Store screenshots: the phone screen (status and navigation bars cropped) framed under a caption.
// [name, title, subtitle, top, bottom]: the rows of the raw screenshot to keep. Screens with a header drop it
// (y < 230); Home keeps its map and brief and stops above the property name, which would identify the owner.
const SHOTS: Array<[string, string, string, number, number]> = [
  ['home', 'Your homestead at a glance', 'Every bed, building and animal on your own land', 100, 1890],
  ['planner', 'A plan you can follow', 'Projects as step-by-step checklists', 230, 2212],
  ['bed', 'Know what to plant together', 'Suggested setups for each bed’s sun and soil', 230, 2212],
  ['design', 'Design on real aerial imagery', 'Beds, coops, trees and water, drawn to scale', 230, 2212],
  ['animals', 'Animals that suit your land', 'Shelter, pasture, water and care for each kind', 230, 2212],
  ['records', 'Records for every animal', 'Your own photos, health, vaccinations and weights', 230, 2212],
];
const shotsArg = process.argv.indexOf('--shots');
const SHOTS_DIR = shotsArg > 0 ? process.argv[shotsArg + 1] : undefined;
const RAW = SHOTS_DIR ? join(SHOTS_DIR, 'raw') : '';
if (SHOTS_DIR) mkdirSync(join(SHOTS_DIR, 'screenshots'), { recursive: true });
SHOTS.forEach(([name, title, sub, top, bottom], i) => {
  if (!SHOTS_DIR) return;
  const file = join(RAW, `${name}.png`);
  if (!existsSync(file)) return console.log('skip (no raw screenshot)', name);
  const data = readFileSync(file).toString('base64');
  // Raw 1080 × 2340, scaled so the kept rows fill a 1500 px tall rounded frame under the caption.
  const scale = 1500 / (bottom - top), w = 1080 * scale, x = (1080 - w) / 2, y = 330;
  png(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1080 1920">${BG}
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <text x="540" y="150" text-anchor="middle" font-family="Bitter" font-weight="700" font-size="64" fill="#ffffff">${title}</text>
    <text x="540" y="222" text-anchor="middle" font-family="Inter" font-size="36" fill="#d6ebc8">${sub}</text>
    <clipPath id="c"><rect x="${x}" y="${y}" width="${w}" height="1500" rx="44"/></clipPath>
    <rect x="${x + 10}" y="${y + 16}" width="${w}" height="1500" rx="44" fill="#000000" opacity="0.3"/>
    <g clip-path="url(#c)"><image x="${x}" y="${y - top * scale}" width="${w}" height="${2340 * scale}" xlink:href="data:image/png;base64,${data}"/></g>
    <rect x="${x}" y="${y}" width="${w}" height="1500" rx="44" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3"/>
  </svg>`, 1080, join(SHOTS_DIR, 'screenshots', `${i + 1}-${name}.png`));
});
