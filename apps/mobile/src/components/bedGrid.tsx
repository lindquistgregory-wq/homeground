/**
 * Bed layout on a 1 × 1 ft grid (§7.2): pick a planting, then tap squares to place it. Long-press a
 * square to fill its whole row. A square holds one crop; the legend shows how many plants fit in the
 * squares each crop has, at square-foot spacing.
 */
import { assignCells, cellKey, cellsInGrid, plantById, plantsInSquares, type BedGrid, type Cell } from '@plotwright/core';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './Text';
import type { Planting } from '../db/plantings';
import { Body, Button, useTheme } from './ui';

// Distinct fills that read in light and dark themes, with white labels.
const COLORS = ['#c0392b', '#2e86c1', '#239b56', '#d68910', '#8e44ad', '#138d75', '#c2185b', '#6d4c41', '#5d6d7e', '#b7950b'];

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

  const color = (id: string) => COLORS[Math.max(0, plantings.findIndex((p) => p.id === id)) % COLORS.length]!;
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, cs] of Object.entries(layout)) for (const c of cs) m.set(cellKey(c), id);
    return m;
  }, [layout]);
  const dirty = plantings.some((p) => JSON.stringify(layout[p.id] ?? []) !== JSON.stringify(initial[p.id] ?? []));
  const free = grid.cells - owner.size;

  // Card and screen padding take about 64 px; squares stay between 24 and 72 px so they remain tappable.
  const cell = Math.max(24, Math.min(72, Math.floor((width - 64) / grid.cols)));
  const showLabels = cell >= 30;

  const place = (cells: Cell[]) => { if (active) setLayout((l) => assignCells(l, active, cells)); };
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

  const activePlant = plantings.find((p) => p.id === active);
  return (
    <View>
      <Body muted>
        {grid.cols} × {grid.rows} ft · {grid.cells} squares of 1 ft (30 cm){free > 0 ? ` · ${free} empty` : ''}. Pick a crop below, then tap squares to place it; tap again to clear, long-press to fill a row.
      </Body>

      <View style={styles.legend}>
        {plantings.map((p) => {
          const plant = plantById(p.plantId);
          const n = (layout[p.id] ?? []).length;
          const fit = plant ? plantsInSquares(plant, n) : { plants: 0 };
          const each: ReturnType<typeof plantsInSquares> = plant ? plantsInSquares(plant, 1) : { plants: 0 };
          const sel = p.id === active;
          return (
            <Pressable key={p.id} onPress={() => setActive(p.id)} accessibilityRole="button" accessibilityState={{ selected: sel }}
              accessibilityLabel={`${plant?.commonName ?? p.plantId}, ${n} squares${sel ? ', selected for placing' : ''}`}
              style={[styles.legendItem, { borderColor: sel ? t.accent : t.border, borderWidth: sel ? 2 : 1, backgroundColor: t.card }]}>
              <View style={[styles.swatch, { backgroundColor: color(p.id) }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>{plant?.commonName ?? p.plantId}{p.variety ? ` ‘${p.variety}’` : ''}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {n === 0 ? 'Not placed yet' : `${n} square${n === 1 ? '' : 's'} · about ${fit.plants} plant${fit.plants === 1 ? '' : 's'}`}
                  {each.perSquare ? ` (${each.perSquare} per square)` : each.squaresPerPlant ? ` (${each.squaresPerPlant} squares each)` : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={grid.cols * cell > width - 64} contentContainerStyle={{ paddingVertical: 8, flexGrow: 1, justifyContent: 'center' }}>
        <View accessibilityLabel={`Bed grid, ${grid.cols} squares across and ${grid.rows} long`} style={{ borderWidth: 2, borderColor: t.dark ? '#6b5640' : '#8b6b4a' }}>
          {Array.from({ length: grid.rows }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row' }}>
              {Array.from({ length: grid.cols }, (_, c) => {
                const id = owner.get(cellKey([c, r]));
                const plant = id ? plantById(plantings.find((p) => p.id === id)?.plantId ?? '') : undefined;
                return (
                  <Pressable
                    key={c}
                    onPress={() => place([[c, r]])}
                    onLongPress={() => place(Array.from({ length: grid.cols }, (_, cc) => [cc, r] as Cell))}
                    accessibilityRole="button"
                    accessibilityLabel={`Square ${c + 1} across, ${r + 1} along: ${plant?.commonName ?? 'empty'}`}
                    style={{
                      width: cell, height: cell, borderWidth: StyleSheet.hairlineWidth, borderColor: t.dark ? '#5a4a3a' : '#a08060',
                      backgroundColor: id ? color(id) : t.dark ? '#2b241c' : '#e9dccb', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {showLabels && plant && <Text style={styles.cellText} numberOfLines={1}>{plant.commonName.slice(0, 2)}</Text>}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.actions}>
        {activePlant && free > 0 && <Button title={`Fill empty squares with ${plantById(activePlant.plantId)?.commonName ?? 'this crop'}`} kind="secondary" onPress={fillRest} />}
        {dirty && <Button title={saving ? 'Saving…' : 'Save layout'} onPress={save} disabled={saving} />}
        {dirty && <Button title="Undo changes" kind="secondary" onPress={() => setLayout(initial)} disabled={saving} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { gap: 6, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, padding: 8 },
  swatch: { width: 22, height: 22, borderRadius: 4 },
  cellText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  actions: { gap: 8, marginTop: 4 },
});
