/**
 * Three Play Store feature-graphic options (1024 × 500) for the owner to choose from, drawn from the
 * app's own mark and palette (no real property in them). Run: pnpm tsx scripts/make-feature-options.ts <out folder>
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs/store');
const FONTS = [
  ...['400Regular/Inter_400Regular.ttf', '600SemiBold/Inter_600SemiBold.ttf', '700Bold/Inter_700Bold.ttf'].map((f) => join(ROOT, 'node_modules/@expo-google-fonts/inter', f)),
  join(ROOT, 'node_modules/@expo-google-fonts/bitter/700Bold/Bitter_700Bold.ttf'),
];
const COLOURS = { SUN: '#ffcf5a', FIELD1: '#b7e08a', FIELD2: '#8cc46f', FURROW: '#6fa84c', STEM: '#f7f3e3', LEAF1: '#f7f3e3', LEAF2: '#ffffff', VEIN: '#cfe6b8' };
const mark = Object.entries(COLOURS).reduce((s, [k, v]) => s.replaceAll(`"${k}"`, `"${v}"`), readFileSync(join(ROOT, 'apps/mobile/assets/src/mark.svg.part'), 'utf8'));
const icon = (x: number, y: number, size: number) => `<g transform="translate(${x} ${y}) scale(${size / 1024})">
  <defs><linearGradient id="ig${x}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f8f35"/><stop offset="1" stop-color="#1f5a24"/></linearGradient></defs>
  <rect width="1024" height="1024" rx="230" fill="url(#ig${x})"/>${mark}</g>`;

function png(svg: string, name: string) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' } });
  const file = join(OUT, name);
  writeFileSync(file, r.render().asPng());
  console.log('wrote', file);
}

// A small top-down homestead, like the app's map: fields, rows of beds, coop, barn, pond, orchard, animals.
const homestead = (ox: number, oy: number) => {
  const beds = Array.from({ length: 12 }, (_, i) => {
    const c = i % 4, r = Math.floor(i / 4);
    return `<rect x="${ox + 40 + c * 34}" y="${oy + 150 + r * 52}" width="24" height="42" rx="3" fill="#6E4F33" stroke="#E3D3B0" stroke-width="2"/>
      ${[0, 1, 2].map((k) => `<rect x="${ox + 43 + c * 34}" y="${oy + 155 + r * 52 + k * 12}" width="18" height="6" rx="3" fill="#7fae52"/>`).join('')}`;
  }).join('');
  const trees = Array.from({ length: 9 }, (_, i) => `<circle cx="${ox + 250 + (i % 3) * 38}" cy="${oy + 40 + Math.floor(i / 3) * 38}" r="14" fill="#2F5A2C"/><circle cx="${ox + 246 + (i % 3) * 38}" cy="${oy + 36 + Math.floor(i / 3) * 38}" r="6" fill="#4f8a3c"/>`).join('');
  const hen = (x: number, y: number, f = '#F5F1E6') => `<ellipse cx="${x}" cy="${y}" rx="7" ry="5.5" fill="${f}" stroke="#6B5D50" stroke-width="1.2"/><circle cx="${x + 6}" cy="${y - 4}" r="3" fill="${f}" stroke="#6B5D50" stroke-width="1.2"/><path d="M${x + 5} ${y - 7.5} l1.6 1.6" stroke="#B23A2A" stroke-width="2"/>`;
  const goat = (x: number, y: number, f: string) => `<path d="M${x - 6} ${y + 4}v6M${x - 2} ${y + 4}v6M${x + 4} ${y + 4}v6M${x + 8} ${y + 4}v6" stroke="#3B2A1A" stroke-width="2"/><ellipse cx="${x + 1}" cy="${y}" rx="10" ry="6" fill="${f}" stroke="#3B2A1A" stroke-width="1.2"/><circle cx="${x + 11}" cy="${y - 5}" r="4" fill="${f}" stroke="#3B2A1A" stroke-width="1.2"/>`;
  return `
  <rect x="${ox}" y="${oy}" width="420" height="360" rx="28" fill="#7E9459"/>
  <path d="M ${ox} ${oy + 250} L ${ox + 200} ${oy + 236} L ${ox + 210} ${oy + 360} L ${ox} ${oy + 360} Z" fill="#8BA264"/>
  <path d="M ${ox + 420} ${oy + 330} C ${ox + 360} ${oy + 300} ${ox + 330} ${oy + 230} ${ox + 300} ${oy + 190}" stroke="#CDBB92" stroke-width="10" fill="none" stroke-linecap="round"/>
  <rect x="${ox + 14}" y="${oy + 14}" width="392" height="332" rx="18" fill="none" stroke="#F3E1B0" stroke-width="3" stroke-dasharray="10 7"/>
  ${trees}
  ${beds}
  <rect x="${ox + 210}" y="${oy + 170}" width="70" height="52" rx="4" fill="#8E3B2E" stroke="#4A2018" stroke-width="2.5"/><path d="M ${ox + 245} ${oy + 170} v52" stroke="#6e2b22" stroke-width="3"/>
  <rect x="${ox + 196}" y="${oy + 156}" width="170" height="104" rx="10" fill="rgba(243,225,176,0.12)" stroke="#EADBB4" stroke-width="2" stroke-dasharray="7 5"/>
  ${goat(ox + 310, oy + 200, '#8A6A4A')}${goat(ox + 330, oy + 236, '#E9E1D2')}
  <rect x="${ox + 300}" y="${oy + 280}" width="40" height="32" rx="3" fill="#B08A4A" stroke="#5C4522" stroke-width="2"/>
  <rect x="${ox + 292}" y="${oy + 272}" width="104" height="62" rx="6" fill="rgba(214,197,150,0.3)" stroke="#F3E1B0" stroke-width="2" stroke-dasharray="6 4"/>
  ${hen(ox + 356, oy + 292)}${hen(ox + 372, oy + 312, '#A0603A')}${hen(ox + 352, oy + 318, '#2E2A26')}
  <ellipse cx="${ox + 90}" cy="${oy + 315}" rx="56" ry="26" fill="#1D6F7A" stroke="#C9D9C0" stroke-width="2.5"/><ellipse cx="${ox + 80}" cy="${oy + 308}" rx="26" ry="9" fill="#4FA3AE" opacity="0.7"/>
  <rect x="${ox + 186}" y="${oy + 300}" width="18" height="18" rx="3" fill="#E7B93C" stroke="#6B4E0E" stroke-width="2"/>
  <ellipse cx="${ox + 150}" cy="${oy + 120}" rx="11" ry="7" fill="#F2ECDD" stroke="#5E5141" stroke-width="1.4"/><circle cx="${ox + 161}" cy="${oy + 115}" r="5" fill="#F2ECDD" stroke="#5E5141" stroke-width="1.4"/>`;
};

/** A row of pill labels, each sized to its text (about 10.5 px a character at 19 px semibold). */
const chips = (x: number, y: number, labels: string[], fill: string, ink: string) => {
  let cx = x;
  return labels.map((label) => {
    const w = Math.round(label.replace('&amp;', '&').length * 10.5 + 32);
    const out = `<rect x="${cx}" y="${y}" width="${w}" height="40" rx="20" fill="${fill}"/><text x="${cx + 16}" y="${y + 26}" font-family="Inter" font-weight="600" font-size="19" fill="${ink}">${label}</text>`;
    cx += w + 10;
    return out;
  }).join('');
};

mkdirSync(OUT, { recursive: true });

// Option 1: brand green, the mark and name, a tidy homestead map on the right.
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f8f35"/><stop offset="1" stop-color="#1f5a24"/></linearGradient></defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  ${icon(64, 70, 96)}
  <text x="64" y="232" font-family="Bitter" font-weight="700" font-size="72" fill="#ffffff">Plotwright</text>
  <text x="66" y="280" font-family="Inter" font-size="26" fill="#e2efdb">Plan your homestead on your own land</text>
  ${chips(64, 326, ['Beds &amp; crops', 'Animals', 'Step-by-step plans'], 'rgba(255,255,255,0.16)', '#ffffff')}
  <g transform="translate(612 78) scale(0.88) rotate(-3 210 180)">${homestead(0, 0)}</g>
</svg>`, 'feature-option-1-brand.png');

// Option 2: light prairie (oat background), the homestead as the hero, denim headline.
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="#F7F4EC"/>
  <path d="M 0 420 Q 260 380 520 420 T 1024 410 L 1024 500 L 0 500 Z" fill="#EDE7D9"/>
  ${homestead(40, 70)}
  ${icon(520, 92, 64)}
  <text x="600" y="140" font-family="Bitter" font-weight="700" font-size="44" fill="#22252B">Plotwright</text>
  <text x="522" y="232" font-family="Bitter" font-weight="700" font-size="42" fill="#35577A">Your land.</text>
  <text x="522" y="284" font-family="Bitter" font-weight="700" font-size="42" fill="#35577A">Your plan.</text>
  <text x="522" y="336" font-family="Bitter" font-weight="700" font-size="42" fill="#4F6E3A">Season by season.</text>
  <text x="524" y="388" font-family="Inter" font-size="21" fill="#5E6168">Gardens, orchards and animals,</text>
  <text x="524" y="416" font-family="Inter" font-size="21" fill="#5E6168">mapped on real aerial imagery.</text>
</svg>`, 'feature-option-2-prairie.png');

// Option 3: dark charcoal, three feature tiles (map, plan, plant) under the name.
const tile = (x: number, title: string, sub: string, art: string) => `
  <rect x="${x}" y="230" width="290" height="210" rx="24" fill="#202328" stroke="#353A41" stroke-width="2"/>
  <g transform="translate(${x + 24} 254)">${art}</g>
  <text x="${x + 24}" y="388" font-family="Bitter" font-weight="700" font-size="28" fill="#ECEAE4">${title}</text>
  <text x="${x + 24}" y="418" font-family="Inter" font-size="18" fill="#B9BBC0">${sub}</text>`;
const mapArt = `<rect width="96" height="96" rx="18" fill="#7E9459"/><rect x="10" y="10" width="76" height="76" rx="10" fill="none" stroke="#F3E1B0" stroke-width="3" stroke-dasharray="6 4"/>
  <rect x="20" y="22" width="14" height="24" rx="2" fill="#6E4F33" stroke="#E3D3B0" stroke-width="1.5"/><rect x="40" y="22" width="14" height="24" rx="2" fill="#6E4F33" stroke="#E3D3B0" stroke-width="1.5"/>
  <rect x="58" y="54" width="26" height="20" rx="2" fill="#8E3B2E"/><ellipse cx="30" cy="70" rx="14" ry="8" fill="#1D6F7A"/>`;
const planArt = `<rect width="96" height="96" rx="18" fill="#284563"/>${[0, 1, 2].map((i) => `<circle cx="24" cy="${24 + i * 24}" r="8" fill="${i === 0 ? '#A9CF8C' : 'none'}" stroke="#A7C7EA" stroke-width="3"/><rect x="40" y="${20 + i * 24}" width="${40 - i * 8}" height="8" rx="4" fill="#A7C7EA" opacity="${1 - i * 0.25}"/>`).join('')}<path d="M24 32 v8 M24 56 v8" stroke="#A7C7EA" stroke-width="3"/>`;
const plantArt = `<rect width="96" height="96" rx="18" fill="#4A3800"/><path d="M48 78 V46" stroke="#F3E1B0" stroke-width="6" stroke-linecap="round"/>
  <path d="M48 56 C36 56 24 48 22 34 C36 34 46 42 48 56Z" fill="#A9CF8C"/><path d="M48 48 C54 36 66 30 76 32 C74 44 62 50 48 48Z" fill="#cfe6b8"/><circle cx="70" cy="22" r="7" fill="#EBC75F"/>`;
png(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="#16181C"/>
  ${icon(64, 56, 84)}
  <text x="168" y="112" font-family="Bitter" font-weight="700" font-size="58" fill="#ffffff">Plotwright</text>
  <text x="170" y="156" font-family="Inter" font-size="24" fill="#B9BBC0">The homestead planner built from your own land</text>
  ${tile(50, 'Map it', 'Beds, barns and animals', mapArt)}${tile(367, 'Plan it', 'Projects as checklists', planArt)}${tile(684, 'Grow it', 'What to plant, and when', plantArt)}
</svg>`, 'feature-option-3-tiles.png');
