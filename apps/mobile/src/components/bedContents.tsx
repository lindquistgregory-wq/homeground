/**
 * A bed's plants, right in the design's edit panel: what's in it this year, its square-foot layout,
 * and quick ways to fill it: add plants by hand, or a suggested setup (built-in or AI). The full bed
 * planner (sun, soil, every plant ranked) is still one tap away.
 */
import { allPlants, bedGrid, MAX_GRID_CELLS, objectType, plantById, rotationAdvice, searchPlants, type DesignObject, type PlantSpec } from '@plotwright/core';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { deletePlanting, plantingsForParcel, savePlanting, type Planting } from '../db/plantings';
import { bedHistory, holdsOnePlant, isSpacedSpot, plantsForSpot } from '../services/garden';
import { BedGridEditor } from './bedGrid';
import { SearchField } from './kit';
import { PlantArt } from './PlantArt';
import { Chip } from './plants';
import { Text } from './Text';
import { Body, Button, useTheme } from './ui';

const SHARES: Array<[number, string]> = [[1, 'Whole bed'], [0.5, 'Half'], [0.25, 'Quarter']];

export function BedContents({ bed, parcelId, designId, plantings, onChanged, onPlan, onSuggest, onLabel }: {
  bed: DesignObject; parcelId: string; designId: string;
  /** This bed's plantings growing (or planned) this season. */
  plantings: Planting[];
  onChanged: () => Promise<void>; onPlan?: () => void; onSuggest?: () => void;
  /** One-plant spots: name the object after its plant when it has no name of its own. */
  onLabel?: (label: string) => void;
}) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const year = new Date().getFullYear();
  const used = plantings.reduce((a, p) => a + p.share, 0);
  // The square-foot grid holds this year's crops; perennials from earlier years are listed above it.
  const gridPlantings = plantings.filter((p) => p.year === year);
  const grid = !isSpacedSpot(bed) ? bedGrid(bed.width, bed.length) : null;
  const one = holdsOnePlant(bed);
  const spot = bed.kind === 'orchard' ? 'orchard' : bed.kind === 'vineyard-row' ? 'row' : one ? 'spot' : 'bed';
  const typeName = objectType(bed.kind)?.name;

  return (
    <View style={[styles.box, { borderColor: t.border, backgroundColor: t.surface }]}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>In this {spot} ({year})</Text>
      {plantings.length === 0 ? <Body muted>Nothing planted yet.</Body> : (
        <View style={styles.list}>
          {plantings.map((p) => {
            const plant = plantById(p.plantId);
            return (
              <View key={p.id} style={[styles.item, { backgroundColor: t.card, borderColor: t.border }]}>
                {plant && <PlantArt plant={plant} size={28} />}
                <Text style={{ color: t.text, fontWeight: '600' }}>{plant?.commonName ?? p.plantId}</Text>
                {p.share < 1 && <Text style={{ color: t.muted, fontSize: 12 }}>{Math.round(p.share * 100)}%</Text>}
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${plant?.commonName ?? 'planting'}`} hitSlop={8}
                  onPress={() => Alert.alert('Remove planting?', `Remove ${plant?.commonName ?? 'this planting'}? Mark it harvested in the bed planner instead to keep its rotation history.`, [
                    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await deletePlanting(p.id); await onChanged(); } },
                  ])}>
                  <Text style={{ color: t.muted, fontSize: 16 }}>✕</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {grid && gridPlantings.length > 0 && (grid.cells > MAX_GRID_CELLS
        ? <Body muted>{grid.cols} × {grid.rows} ft: too big for a square-by-square layout here. The bed planner shows row layouts.</Body>
        : <BedGridEditor grid={grid} plantings={gridPlantings} onSave={async (changes) => {
            for (const { planting, cells } of changes) await savePlanting({ ...planting, cells });
            await onChanged();
          }} />)}

      <View style={styles.row}>
        <View style={{ flex: 1 }}><Button title={one ? (plantings.length ? 'Change plant' : 'Choose the plant') : 'Add plants'} icon={one ? 'sprout' : 'plus'} kind="secondary" onPress={() => setAdding(true)} /></View>
        {onSuggest && <View style={{ flex: 1 }}><Button title={one ? 'Suggest a plant' : 'Suggest a setup'} icon="auto-fix" kind="secondary" onPress={onSuggest} /></View>}
      </View>
      {onPlan && <Button title={bed.kind === 'vineyard-row' ? 'Plan this row: grapes and vines' : bed.kind === 'orchard' ? 'Plan this orchard: fruit and nut trees' : 'Plan this bed: what grows best here'} onPress={onPlan} />}

      <AddPlantSheet visible={adding} bed={bed} one={one} freeShare={one ? 1 : Math.max(0, 1 - used)} onClose={() => setAdding(false)}
        onAdd={async (plant, share) => {
          const history = bedHistory((await plantingsForParcel(parcelId)).filter((p) => p.bedObjectId === bed.id));
          const rot = rotationAdvice(plant, history, year);
          // A rotation clash asks first; the sheet marks the plant added only if it was.
          if (!one && !rot.ok && !(await new Promise<boolean>((res) => Alert.alert('Rotation', rot.message, [
            { text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Add anyway', onPress: () => res(true) },
          ], { cancelable: true, onDismiss: () => res(false) })))) return false;
          // One-plant spots: the new plant replaces the old one.
          if (one) for (const p of plantings) await deletePlanting(p.id);
          await savePlanting({ parcelId, designId, bedObjectId: bed.id, plantId: plant.id, year, share: one ? 1 : share, status: 'planned' });
          if (one && onLabel && (!bed.label || bed.label === typeName || plantings.some((p) => plantById(p.plantId)?.commonName === bed.label))) onLabel(plant.commonName);
          await onChanged();
          if (one) setAdding(false);
          return true;
        }} />
    </View>
  );
}

function AddPlantSheet({ visible, bed, one, freeShare, onClose, onAdd }: {
  visible: boolean; bed: DesignObject; one: boolean; freeShare: number; onClose: () => void; onAdd: (p: PlantSpec, share: number) => Promise<boolean>;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [share, setShare] = useState(1);
  const [added, setAdded] = useState<string[]>([]);
  const fits = plantsForSpot(bed, allPlants());
  const ids = q.trim() ? new Set(searchPlants(q).map((p) => p.id)) : null;
  const list = (ids ? fits.filter((p) => ids.has(p.id)) : fits).sort((a, b) => a.commonName.localeCompare(b.commonName)).slice(0, ids ? 60 : 200);
  const close = () => { setQ(''); setAdded([]); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 44 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <View style={[styles.row, { alignItems: 'center' }]}>
            <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', flex: 1 }} accessibilityRole="header">{one ? 'Choose the plant' : 'Add plants'}</Text>
            <Button title="Done" onPress={close} />
          </View>
          {one ? <Body muted>This spot holds one plant. Choosing another replaces it.</Body> : (
            <>
              <Body muted>{freeShare < 0.99 ? `About ${Math.round(freeShare * 100)}% of this bed is free. ` : ''}Pick how much room each plant takes, then tap Add.</Body>
              <View style={styles.row}>{SHARES.map(([v, l]) => <Chip key={v} label={l} active={share === v} onPress={() => setShare(v)} />)}</View>
            </>
          )}
          <SearchField value={q} onChangeText={setQ} placeholder={`Search ${fits.length} plants`} accessibilityLabel="Search plants to add" />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
          {list.length === 0 && <Body muted>No plants for this spot match “{q}”.</Body>}
          {list.map((p) => {
            const done = added.includes(p.id);
            return (
              <View key={p.id} style={[styles.pick, { borderColor: t.border }]}>
                <PlantArt plant={p} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{p.commonName}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{p.season === 'perennial' ? 'Perennial' : `${p.season === 'cool' ? 'Cool' : 'Warm'} season`} · {p.sunHours.min}+ h sun</Text>
                </View>
                <Chip label={done ? 'Added' : one ? 'Choose' : 'Add'} active={done} onPress={() => { if (!done) void onAdd(p, share).then((ok) => { if (ok) setAdded((a) => [...a, p.id]); }); }} />
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 10, marginVertical: 8 },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 18, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
});
