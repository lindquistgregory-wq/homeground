/**
 * Bed layout on a 1 × 1 ft grid (§7.2): the bed is drawn as a raised bed (wood frame, soil, twine
 * marking each square foot) with each crop's plants at their square-foot spacing. Pick a crop, then
 * tap squares to place it; tap again to clear, long-press to fill a row. A square holds one crop.
 * Invisible tap targets sit over the drawing, one per square, with screen-reader labels.
 */
import { assignCells, cellKey, cellsInGrid, plantById, plantMarks, plantsInSquares, type BedGrid, type Cell } from '@plotwright/core';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Planting } from '../db/plantings';
import { PlantArt, PlantGlyph } from './PlantArt';
import { Text } from './Text';
import { Body, Button, tapFeedback, useTheme } from './ui';

/** Deterministic 0–1 noise, so the soil texture doesn't shimmer between renders. */
const noise = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function BedGridEditor({ grid, plantings, onSave }: {
  grid: BedGrid;
  plantings: Planting[];
  onSave: (changes: Array<{ planting: Planting; cells: Cell[] }>) => Promise<void>;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const initial = useMemo(() => Object.fromEntries(plantings.map((p) => [p.id, cellsInGrid(p.cells, grid)])), [plantings, grid]);
  const [layout, setLayout] = useState<Record<string, Cell[]>>(initial);
  const [active, setActive] = useState<string | null>(plantings[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLayout(initial); }, [initial]);
  useEffect(() => { if (!plantings.some((p) => p.id === active)) setActive(plantings[0]?.id ?? null); }, [plantings, active]);

  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, cs] of Object.entries(layout)) for (const c of cs) m.set(cellKey(c), id);
    return m;
  }, [layout]);
  const dirty = plantings.some((p) => JSON.stringify(layout[p.id] ?? []) !== JSON.stringify(initial[p.id] ?? []));
  const free = grid.cells - owner.size;

  // The frame takes ~F px each side; squares stay between 24 and 72 px so they remain tappable.
  const cell = Math.max(24, Math.min(72, Math.floor((width - 88) / grid.cols)));
  const F = Math.max(10, Math.round(cell * 0.24));
  const W = grid.cols * cell + 2 * F, H = grid.rows * cell + 2 * F;

  const place = (cells: Cell[]) => { if (active) { tapFeedback(); setLayout((l) => assignCells(l, active, cells)); } };
  const fillRest = () => {
    if (!active) return;
    const empty: Cell[] = [];
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (!owner.has(cellKey([c, r]))) empty.push([c, r]);
    if (empty.length) place(empty);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(plantings.filter((p) => JSON.stringify(layout[p.id] ?? []) !== JSON.stringify(initial[p.id] ?? [])).map((p) => ({ planting: p, cells: layout[p.id] ?? [] })));
    } finally {
      setSaving(false);
    }
  };

  // Plants to draw, smallest first so big crops overlap small ones naturally.
  const marks = useMemo(() => plantings.flatMap((p) => {
    const plant = plantById(p.plantId);
    if (!plant) return [];
    return plantMarks(plant, layout[p.id] ?? []).map((m) => ({ ...m, plantId: plant.id, kind: plant.kind }));
  }).sort((a, b) => a.size - b.size || a.y - b.y), [plantings, layout]);

  const soil = t.dark ? '#3a2c20' : '#6e4f35';
  const soilDot = t.dark ? ['#4a3a2b', '#2c2118'] : ['#80603f', '#5a3f29'];
  const twine = t.dark ? '#8a7558' : '#c9ad84';
  const activePlant = plantings.find((p) => p.id === active);

  return (
    <View>
      <Body muted>
        {grid.cols} × {grid.rows} ft · {grid.cells} squares{free > 0 ? ` · ${free} empty` : ''}. Pick a crop, then tap squares; tap again to clear, hold to fill a row.
      </Body>

      <View style={styles.legend}>
        {plantings.map((p) => {
          const plant = plantById(p.plantId);
          const n = (layout[p.id] ?? []).length;
          const fit = plant ? plantsInSquares(plant, n) : { plants: 0 };
          const each: ReturnType<typeof plantsInSquares> = plant ? plantsInSquares(plant, 1) : { plants: 0 };
          const sel = p.id === active;
          return (
            <Pressable key={p.id} onPress={() => { tapFeedback(); setActive(p.id); }} accessibilityRole="button" accessibilityState={{ selected: sel }}
              accessibilityLabel={`${plant?.commonName ?? p.plantId}, ${n} squares${sel ? ', selected for placing' : ''}`}
              style={[styles.legendItem, { borderColor: sel ? t.accent : t.border, borderWidth: sel ? 2 : 1, backgroundColor: sel ? t.accentSoft : t.card }]}>
              {plant && <PlantArt plant={plant} size={36} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{plant?.commonName ?? p.plantId}{p.variety ? ` ‘${p.variety}’` : ''}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {n === 0 ? 'Not placed yet' : `${n} square${n === 1 ? '' : 's'} · about ${fit.plants} plant${fit.plants === 1 ? '' : 's'}`}
                  {each.perSquare ? ` (${each.perSquare} per square)` : each.squaresPerPlant ? ` (${each.squaresPerPlant} squares each)` : ''}
                </Text>
              </View>
              {sel && <Text style={{ color: t.accent, fontWeight: '700', fontSize: 12 }}>PLACING</Text>}
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={W > width - 48} contentContainerStyle={{ paddingVertical: 10, flexGrow: 1, justifyContent: 'center' }}>
        <View style={{ width: W, height: H }} accessibilityLabel={`Bed drawing, ${grid.cols} squares across and ${grid.rows} long`}>
          <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="woodH" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#b98552" />
                <Stop offset="0.5" stopColor="#9c6b3d" />
                <Stop offset="1" stopColor="#7d532e" />
              </LinearGradient>
              <LinearGradient id="woodV" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#b98552" />
                <Stop offset="0.5" stopColor="#9c6b3d" />
                <Stop offset="1" stopColor="#7d532e" />
              </LinearGradient>
            </Defs>
            {/* Drop shadow under the bed. */}
            <Rect x={3} y={5} width={W - 3} height={H - 3} rx={F * 0.6} fill="#000000" opacity={0.25} />
            {/* Frame: four boards with grain, darker corner posts. */}
            <Rect x={0} y={0} width={W} height={F} rx={3} fill="url(#woodH)" />
            <Rect x={0} y={H - F} width={W} height={F} rx={3} fill="url(#woodH)" />
            <Rect x={0} y={0} width={F} height={H} rx={3} fill="url(#woodV)" />
            <Rect x={W - F} y={0} width={F} height={H} rx={3} fill="url(#woodV)" />
            {[0.35, 0.65].map((f) => (
              <G key={f} opacity={0.35}>
                <Line x1={F} y1={F * f} x2={W - F} y2={F * f} stroke="#5e3d20" strokeWidth={0.8} />
                <Line x1={F} y1={H - F + F * f} x2={W - F} y2={H - F + F * f} stroke="#5e3d20" strokeWidth={0.8} />
                <Line x1={F * f} y1={F} x2={F * f} y2={H - F} stroke="#5e3d20" strokeWidth={0.8} />
                <Line x1={W - F + F * f} y1={F} x2={W - F + F * f} y2={H - F} stroke="#5e3d20" strokeWidth={0.8} />
              </G>
            ))}
            {[[0, 0], [W - F, 0], [0, H - F], [W - F, H - F]].map(([x, y], i) => (
              <G key={i}>
                <Rect x={x} y={y} width={F} height={F} rx={2} fill="#6b4626" />
                <Circle cx={x! + F / 2} cy={y! + F / 2} r={Math.max(1.2, F * 0.12)} fill="#c9c2b5" />
              </G>
            ))}
            {/* Soil with a speckled texture. */}
            <Rect x={F} y={F} width={grid.cols * cell} height={grid.rows * cell} fill={soil} />
            {Array.from({ length: Math.min(1500, grid.cells * 14) }, (_, i) => (
              <Circle key={i} cx={F + noise(i) * grid.cols * cell} cy={F + noise(i + 7919) * grid.rows * cell}
                r={0.6 + noise(i + 104729) * 1.3} fill={soilDot[i % 2]} opacity={0.8} />
            ))}
            {/* Twine marking each square foot. */}
            {Array.from({ length: grid.cols - 1 }, (_, c) => (
              <Line key={`c${c}`} x1={F + (c + 1) * cell} y1={F} x2={F + (c + 1) * cell} y2={H - F} stroke={twine} strokeWidth={1.2} strokeDasharray="5 3" opacity={0.75} />
            ))}
            {Array.from({ length: grid.rows - 1 }, (_, r) => (
              <Line key={`r${r}`} x1={F} y1={F + (r + 1) * cell} x2={W - F} y2={F + (r + 1) * cell} stroke={twine} strokeWidth={1.2} strokeDasharray="5 3" opacity={0.75} />
            ))}
            {/* The crop being placed: its squares get a soft highlight. */}
            {active && (layout[active] ?? []).map(([c, r]) => (
              <Rect key={`h${c},${r}`} x={F + c * cell + 2} y={F + r * cell + 2} width={cell - 4} height={cell - 4} rx={6}
                fill="#ffffff" opacity={0.1} stroke={t.accent} strokeWidth={1.5} strokeOpacity={0.7} />
            ))}
            {marks.map((m, i) => {
              const cx = F + m.x * cell, cy = F + m.y * cell, size = Math.max(10, m.size * cell);
              // Big crops (a square or more per plant) read as a leafy plant from above, with the crop on top.
              if (m.size < 1.2) return <PlantGlyph key={i} plantId={m.plantId} kind={m.kind} cx={cx} cy={cy} size={size} />;
              const r = size * 0.5;
              return (
                <G key={i}>
                  <Circle cx={cx + 3} cy={cy + 4} r={r} fill="#000000" opacity={0.25} />
                  {[0, 60, 120, 180, 240, 300].map((a) => (
                    <Circle key={a} cx={cx + r * 0.42 * Math.cos((a * Math.PI) / 180)} cy={cy + r * 0.42 * Math.sin((a * Math.PI) / 180)}
                      r={r * 0.56} fill={a % 120 ? '#3f8a35' : '#4f9a3a'} />
                  ))}
                  <Circle cx={cx} cy={cy} r={r * 0.5} fill="#5aa840" />
                  <PlantGlyph plantId={m.plantId} kind={m.kind} cx={cx} cy={cy} size={size * 0.55} />
                </G>
              );
            })}
          </Svg>
          {/* Invisible tap targets, one per square. */}
          {Array.from({ length: grid.rows }, (_, r) => Array.from({ length: grid.cols }, (_, c) => {
            const id = owner.get(cellKey([c, r]));
            const plant = id ? plantById(plantings.find((p) => p.id === id)?.plantId ?? '') : undefined;
            return (
              <Pressable
                key={`${c},${r}`}
                onPress={() => place([[c, r]])}
                onLongPress={() => place(Array.from({ length: grid.cols }, (_, cc) => [cc, r] as Cell))}
                accessibilityRole="button"
                accessibilityLabel={`Square ${c + 1} across, ${r + 1} along: ${plant?.commonName ?? 'empty'}`}
                style={({ pressed }) => [{ position: 'absolute', left: F + c * cell, top: F + r * cell, width: cell, height: cell }, pressed && { backgroundColor: 'rgba(255,255,255,0.15)' }]}
              />
            );
          }))}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        {activePlant && free > 0 && <Button icon="format-color-fill" title={`Fill empty squares with ${plantById(activePlant.plantId)?.commonName ?? 'this crop'}`} kind="secondary" onPress={fillRest} />}
        {dirty && <Button icon="content-save-outline" title={saving ? 'Saving…' : 'Save layout'} onPress={save} disabled={saving} />}
        {dirty && <Button icon="undo-variant" title="Undo changes" kind="secondary" onPress={() => setLayout(initial)} disabled={saving} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { gap: 6, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 8 },
  actions: { gap: 8, marginTop: 4 },
});
