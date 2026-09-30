/**
 * Design exports (§6), generated on-device: GeoJSON, KML, DXF (UTM metres) and a to-scale SVG plan
 * with scale bar and north arrow (the app turns it into PDF/PNG). Parcel lines from "display only"
 * county sources are left out of GIS exports so their terms are respected.
 */
import { project, type LocalFrame } from '../geo/measure';
import { toPolygons, type Areal } from '../geo/types';
import { utmEpsg } from '../geo/utm';
import { objectType } from './library';
import { footprintLonLat, footprintUtm, materialList, type Design } from './design';

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export interface ExportOptions {
  /** Include the parcel boundary (false when the source is display-only). */
  includeBoundary: boolean;
}

export function designToGeoJSON(d: Design, boundary: Areal, frame: LocalFrame, opts: ExportOptions): string {
  const features: unknown[] = d.objects.map((o) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [footprintLonLat(o, frame)] },
    properties: {
      id: o.id, kind: o.kind, name: o.label ?? objectType(o.kind)?.name ?? o.kind, width_m: o.width, length_m: o.length, height_m: o.height, rotation_deg: o.rotationDeg, cost_usd: o.costUsd ?? null,
      ...(o.existing ? { source: '© OpenStreetMap contributors', license: 'ODbL 1.0' } : {}),
    },
  }));
  if (opts.includeBoundary) features.unshift({ type: 'Feature', geometry: boundary, properties: { kind: 'property-boundary', note: 'Approximate; not a survey' } });
  return JSON.stringify({ type: 'FeatureCollection', name: d.name, features }, null, 1);
}

export function designToKML(d: Design, boundary: Areal, frame: LocalFrame, opts: ExportOptions): string {
  const ring = (pts: number[][]) => pts.map((p) => `${p[0]!.toFixed(7)},${p[1]!.toFixed(7)},0`).join(' ');
  const poly = (name: string, pts: number[][]) =>
    `<Placemark><name>${esc(name)}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(pts)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const parts: string[] = [];
  if (opts.includeBoundary) for (const p of toPolygons(boundary)) parts.push(poly('Property boundary (approximate)', p[0]!));
  for (const o of d.objects) parts.push(poly(o.label ?? objectType(o.kind)?.name ?? o.kind, footprintLonLat(o, frame)));
  const osm = d.objects.some((o) => o.existing) ? '<description>Existing building outlines © OpenStreetMap contributors (ODbL 1.0).</description>' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(d.name)}</name>${osm}${parts.join('')}</Document></kml>\n`;
}

/**
 * AutoCAD R12 (AC1009) DXF: one closed POLYLINE/VERTEX/SEQEND per object, layers by category,
 * coordinates in UTM metres. R12 is the most widely readable DXF flavour.
 */
export function designToDXF(d: Design, boundary: Areal, frame: LocalFrame, opts: ExportOptions): string {
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const poly = (layer: string, pts: Array<[number, number]>) => {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '10', '0.0', '20', '0.0', '30', '0.0', '70', '1');
    for (const [x, y] of pts.slice(0, -1)) out.push('0', 'VERTEX', '8', layer, '10', x.toFixed(3), '20', y.toFixed(3), '30', '0.0');
    out.push('0', 'SEQEND', '8', layer);
  };
  if (opts.includeBoundary) for (const p of toPolygons(boundary)) poly('BOUNDARY', p[0]!.map((q) => project(frame, q)));
  for (const o of d.objects) poly(o.existing ? 'EXISTING_OSM' : (objectType(o.kind)?.category ?? 'OTHER').toUpperCase().replace(/[^A-Z0-9]/g, '_'), footprintUtm(o, frame));
  out.push('0', 'ENDSEC', '0', 'EOF');
  const ascii = (t: string) => t.replace(/[^\x20-\x7e]/g, '?');
  const osm = d.objects.some((o) => o.existing) ? '\n999\nLayer EXISTING_OSM: building outlines (c) OpenStreetMap contributors, ODbL 1.0' : '';
  return `999\n${ascii(`Plotwright design "${d.name}" - UTM zone ${frame.zone.zone}${frame.zone.hemisphere} (EPSG:${utmEpsg(frame.zone)}), metres`)}${osm}\n${out.join('\n')}\n`;
}

const CATEGORY_FILL: Record<string, string> = {
  growing: '#8cc96b', trees: '#3f7f3a', structure: '#b9b2a3', animals: '#d8a86b', 'water-soil': '#6fa8dc', 'energy-utility': '#9a9a9a',
};

/**
 * To-scale SVG plan sized to fit the page, with a scale bar, a north arrow, a legend and the
 * material list.
 */
export function designToSVG(d: Design, boundary: Areal, frame: LocalFrame, opts: { units: 'imperial' | 'metric'; title?: string; marginPx?: number } ): string {
  const outer = toPolygons(boundary).map((p) => p[0]!.map((q) => project(frame, q)));
  const all = [...outer.flat(), ...d.objects.flatMap((o) => footprintUtm(o, frame))];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = opts.marginPx ?? 60;
  const drawW = 900;
  const scale = drawW / Math.max(1, maxX - minX); // px per metre
  const drawH = (maxY - minY) * scale;
  const W = drawW + margin * 2, H = drawH + margin * 2 + 160;
  const P = (x: number, y: number) => `${(margin + (x - minX) * scale).toFixed(1)},${(margin + (maxY - y) * scale).toFixed(1)}`;
  const path = (ring: Array<[number, number]>) => `M${ring.map(([x, y]) => P(x, y)).join('L')}Z`;

  // Scale bar: a round length about 1/5 of the drawing width.
  const unitM = opts.units === 'imperial' ? 0.3048 : 1;
  const target = (maxX - minX) / 5 / unitM;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((n) => n >= target) ?? 1000;
  const barPx = nice * unitM * scale;
  const unitLabel = opts.units === 'imperial' ? 'ft' : 'm';

  const shapes = d.objects.map((o) => {
    const cat = objectType(o.kind)?.category ?? 'growing';
    return `<path d="${path(footprintUtm(o, frame))}" fill="${CATEGORY_FILL[cat] ?? '#ccc'}" fill-opacity="0.85" stroke="#333" stroke-width="1"><title>${esc(o.label ?? objectType(o.kind)?.name ?? o.kind)}</title></path>`;
  });
  const list = materialList(d.objects, frame)
    .map((m, k) => `<text x="${margin}" y="${margin + drawH + 70 + k * 16}" font-size="12">${m.count} × ${esc(m.name)}${m.lengthM ? ` — ${(m.lengthM / unitM).toFixed(0)} ${unitLabel}` : ''}</text>`)
    .slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="Helvetica, Arial, sans-serif">
<rect width="100%" height="100%" fill="#fff"/>
<text x="${margin}" y="${margin - 24}" font-size="20" font-weight="bold">${esc(opts.title ?? d.name)}</text>
${outer.map((r) => `<path d="${path(r)}" fill="none" stroke="#c28a00" stroke-width="2.5" stroke-dasharray="8 4"/>`).join('\n')}
${shapes.join('\n')}
<g transform="translate(${W - margin - 20},${margin + 10})"><path d="M0,-18 L8,10 L0,4 L-8,10 Z" fill="#222"/><text x="0" y="28" font-size="14" text-anchor="middle">N</text></g>
<g transform="translate(${margin},${margin + drawH + 30})"><rect width="${barPx.toFixed(1)}" height="6" fill="#222"/><text x="0" y="22" font-size="12">0</text><text x="${barPx.toFixed(1)}" y="22" font-size="12" text-anchor="end">${nice} ${unitLabel}</text></g>
${list.join('\n')}
<text x="${margin}" y="${H - 12}" font-size="10" fill="#555">Property line approximate — not a survey. Generated by Plotwright.${d.objects.some((o) => o.existing) ? ' Existing buildings © OpenStreetMap contributors.' : ''}</text>
</svg>`;
}
