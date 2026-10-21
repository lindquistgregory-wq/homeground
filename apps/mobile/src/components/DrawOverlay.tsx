/**
 * Freehand drawing over the design map: the overlay takes the finger (so the map doesn't pan) and
 * draws the stroke live; on lift the design screen tidies it and turns it into a custom line or area.
 */
import { useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { Text } from './Text';
import { Chip } from './plants';
import { Body, Button, Card, useTheme } from './ui';
import { useSettings } from '../services/settings';

type Pt = [number, number];

export function DrawOverlay({ onStroke, onCancel }: { onStroke: (points: Pt[]) => void; onCancel: () => void }) {
  const t = useTheme();
  const pts = useRef<Pt[]>([]);
  const [live, setLive] = useState<Pt[]>([]);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { pts.current = [[e.nativeEvent.locationX, e.nativeEvent.locationY]]; setLive(pts.current); },
    onPanResponderMove: (e) => {
      const p: Pt = [e.nativeEvent.locationX, e.nativeEvent.locationY];
      const last = pts.current[pts.current.length - 1]!;
      // Every few pixels is plenty; the stroke is simplified afterwards anyway.
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 4) { pts.current = [...pts.current, p]; setLive(pts.current); }
    },
    onPanResponderRelease: () => onStroke(pts.current),
    onPanResponderTerminate: () => onStroke(pts.current),
  })).current;
  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} accessible accessibilityLabel="Drawing area: draw with one finger, lift to finish">
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {live.length > 1 && <Polyline points={live.map((p) => p.join(',')).join(' ')} stroke="#ffd166" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      </Svg>
      <View style={[styles.banner, { backgroundColor: t.card }]}>
        <Text style={{ color: t.text, flex: 1 }}>Draw with one finger. End near the start to make a closed area.</Text>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={10}><Text style={{ color: t.accent, fontWeight: '600' }}>Cancel</Text></Pressable>
      </View>
    </View>
  );
}

/** Name the drawing and confirm whether it's a line or an area. */
export function DrawnDialog({ value, onSave, onCancel }: {
  value: { closed: boolean } | null; onCancel: () => void;
  onSave: (v: { label: string; closed: boolean; height: number }) => void;
}) {
  const t = useTheme();
  const imperial = useSettings((s) => s.units) === 'imperial';
  const [label, setLabel] = useState('');
  const [closed, setClosed] = useState<boolean | null>(null);
  const [height, setHeight] = useState('');
  if (!value) return null;
  const isArea = closed ?? value.closed;
  const h = Number(height);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <Card title="What did you draw?" icon="draw">
          <View style={styles.chips}>
            <Chip label="A line (fence, path, hedge)" active={!isArea} onPress={() => setClosed(false)} />
            <Chip label="An area (garden, pen, woodlot)" active={isArea} onPress={() => setClosed(true)} />
          </View>
          <TextInput value={label} onChangeText={setLabel} placeholder={isArea ? 'Name it, e.g. Kitchen garden' : 'Name it, e.g. Pasture fence'} placeholderTextColor={t.muted}
            accessibilityLabel="Name" style={[styles.input, { color: t.text, borderColor: t.border }]} />
          <TextInput value={height} onChangeText={setHeight} keyboardType="decimal-pad" placeholder={`Height, if it casts shade (${imperial ? 'ft' : 'm'}, optional)`} placeholderTextColor={t.muted}
            accessibilityLabel="Height" style={[styles.input, { color: t.text, borderColor: t.border }]} />
          <Body muted>It goes on the plan like any object: move it, label it, add a cost, or delete it.</Body>
          <Button title="Add to the plan" onPress={() => {
            onSave({ label: label.trim(), closed: isArea, height: height && Number.isFinite(h) ? (imperial ? h * 0.3048 : h) : 0 });
            setLabel(''); setClosed(null); setHeight('');
          }} />
          <Button title="Discard" kind="secondary" onPress={() => { setLabel(''); setClosed(null); setHeight(''); onCancel(); }} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  banner: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, marginVertical: 5, fontSize: 15 },
});
