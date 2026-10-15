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
const FONTS = ['400Regular/Inter_400Regular.ttf', '700Bold/Inter_700Bold.ttf'].map((f) => join(ROOT, 'node_modules/@expo-google-fonts/inter', f));

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

// Play Store: 512 px icon and the 1024 × 500 feature graphic.
mkdirSync(STORE, { recursive: true });
png(square(mark(COLOURS)), 512, join(STORE, 'icon-512.png'));
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">${BG}
  <rect width="1024" height="500" fill="url(#bg)"/>
  <path d="M 520 470 Q 780 400 1024 430 L 1024 500 L 470 500 Z" fill="#8cc46f" opacity="0.35"/>
  <path d="M 600 500 Q 820 440 1024 462 L 1024 500 Z" fill="#b7e08a" opacity="0.35"/>
  <g transform="translate(64 120) scale(0.25)"><rect width="1024" height="1024" rx="228" fill="#ffffff" opacity="0.12"/>${mark(COLOURS)}</g>
  <text x="352" y="220" font-family="Inter" font-weight="700" font-size="86" fill="#ffffff">Plotwright</text>
  <text x="356" y="288" font-family="Inter" font-size="38" fill="#e2efdb">Plan your land, plot by plot.</text>
  <text x="356" y="344" font-family="Inter" font-size="26" fill="#b7d9a0">Soils · sun · frost dates · planting calendar</text>
</svg>`, 1024, join(STORE, 'feature-graphic.png'));

// Store screenshots: the phone screen (status and navigation bars cropped) framed under a caption.
const SHOTS: Array<[string, string, string]> = [
  ['home', 'Your land at a glance', 'Zone, frost dates and what to do next'],
  ['library', '137 crops, drawn and described', 'From tomatoes to timothy hay'],
  ['detail', 'Know what each plant needs', 'Sun, water, spacing and timing'],
  ['bed', 'Lay out every bed', 'Square-foot planning, drawn to scale'],
  ['design', 'Design your whole property', 'Beds, trees, coops and water on real imagery'],
  ['profile', 'A profile of your parcel', 'Soils, slope, flood zones and streams'],
];
const shotsArg = process.argv.indexOf('--shots');
const SHOTS_DIR = shotsArg > 0 ? process.argv[shotsArg + 1] : undefined;
const RAW = SHOTS_DIR ? join(SHOTS_DIR, 'raw') : '';
if (SHOTS_DIR) mkdirSync(join(SHOTS_DIR, 'screenshots'), { recursive: true });
SHOTS.forEach(([name, title, sub], i) => {
  if (!SHOTS_DIR) return;
  const file = join(RAW, `${name}.png`);
  if (!existsSync(file)) return console.log('skip (no raw screenshot)', name);
  const data = readFileSync(file).toString('base64');
  // Raw 1080 × 2340: keep everything between the status bar and the system nav bar (y ≈ 2215); screens with a
  // header also drop the header (y < 230), and Home (no header) keeps its greeting.
  const top = name === 'home' ? 100 : 230, h = 2212 - top, scale = 1500 / h, w = 1080 * scale, x = (1080 - w) / 2, y = 330;
  png(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1080 1920">${BG}
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <text x="540" y="150" text-anchor="middle" font-family="Inter" font-weight="700" font-size="66" fill="#ffffff">${title}</text>
    <text x="540" y="222" text-anchor="middle" font-family="Inter" font-size="38" fill="#d6ebc8">${sub}</text>
    <clipPath id="c"><rect x="${x}" y="${y}" width="${w}" height="1500" rx="44"/></clipPath>
    <rect x="${x + 10}" y="${y + 16}" width="${w}" height="1500" rx="44" fill="#000000" opacity="0.3"/>
    <g clip-path="url(#c)"><image x="${x}" y="${y - top * scale}" width="${w}" height="${2340 * scale}" xlink:href="data:image/png;base64,${data}"/></g>
  </svg>`, 1080, join(SHOTS_DIR, 'screenshots', `${i + 1}-${name}.png`));
});
