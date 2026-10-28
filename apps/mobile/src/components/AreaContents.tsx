/**
 * What's in a hand-drawn area ("my garden", "the back paddock"): every object whose centre is inside
 * it, anything added to it by hand, and the animals there (housed in those objects or placed inside).
 * Tap a row to select that object. "Add objects to this area" links ones that sit outside or across
 * the line; "Remove" takes one off the list without deleting it from the map.
 */
import { areaMembers, inDrawnArea, linkToArea, objectType, plantById, type DesignObject } from '@plotwright/core';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Herd } from '../db/herds';
import type { Planting } from '../db/plantings';
import { herdLabel, isCurrent } from '../services/animals';
import { Icon } from './Icon';
import { CATEGORY_COLOR, objectIcon } from './objectIcons';
import { Text } from './Text';
import { Body, Button, Card, tapFeedback, useTheme } from './ui';

const nameOf = (o: DesignObject) => o.label ?? objectType(o.kind)?.name ?? o.kind;

export function AreaContents({ area, objects, herds, plantings, onChange, onSelect, onSelectHerd, onPlaceNew }: {
  area: DesignObject; objects: DesignObject[]; herds: Herd[]; plantings: Planting[];
  /** Save the area with its updated lists. */
  onChange: (area: DesignObject) => void;
  onSelect: (objectId: string) => void;
  onSelectHerd: (herdId: string) => void;
  /** Open the object library to place something new (placed inside, it joins the area). */
  onPlaceNew: () => void;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const members = areaMembers(area, objects);
  const memberIds = new Set(members.map((m) => m.object.id));
  const live = herds.filter(isCurrent);
  // Animals placed directly inside the area (roaming groups with a map spot).
  const roaming = live.filter((h) => !h.objectId && h.location && inDrawnArea(area, [h.location.lon, h.location.lat]));
  const candidates = objects.filter((o) => o.id !== area.id && !memberIds.has(o.id));
  const remove = (id: string) => { tapFeedback(); onChange(linkToArea(area, id, false, objects)); };

  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }} accessibilityRole="header">In this area</Text>
      {members.length === 0 && roaming.length === 0 && (
        <Body muted>Nothing here yet. Anything you place inside this area is added automatically, or add objects that are already on the map.</Body>
      )}
      {members.map(({ object: o, how }) => {
        const type = objectType(o.kind);
        const crops = plantings.filter((p) => p.bedObjectId === o.id);
        const animals = live.filter((h) => h.objectId === o.id);
        const detail = [
          type?.name !== nameOf(o) ? type?.name : undefined,
          crops.length ? crops.slice(0, 3).map((p) => plantById(p.plantId)?.commonName ?? p.plantId).join(', ') + (crops.length > 3 ? ` +${crops.length - 3}` : '') : undefined,
          animals.length ? animals.map((h) => herdLabel(h)).join(', ') : undefined,
          how === 'linked' ? 'added by hand' : undefined,
        ].filter(Boolean).join(' · ');
        return (
          <View key={o.id} style={[styles.row, { borderColor: t.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${nameOf(o)}${detail ? `, ${detail}` : ''}. Select it`} onPress={() => { tapFeedback(); onSelect(o.id); }} style={styles.main}>
              <View style={[styles.icon, { backgroundColor: o.existing ? '#757575' : CATEGORY_COLOR[type?.category ?? ''] ?? t.accent }]}>
                <Icon name={objectIcon(o.kind, type?.category)} size={18} color="#ffffff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{nameOf(o)}</Text>
                {detail ? <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={2}>{detail}</Text> : null}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(o)} from this area`} onPress={() => remove(o.id)} style={styles.remove} hitSlop={6}>
              <Text style={{ color: t.muted, fontSize: 13 }}>Remove</Text>
            </Pressable>
          </View>
        );
      })}
      {roaming.map((h) => (
        <Pressable key={h.id} accessibilityRole="button" accessibilityLabel={`${herdLabel(h)}, on the land here. Select them`} onPress={() => { tapFeedback(); onSelectHerd(h.id); }} style={[styles.row, styles.main, { borderColor: t.border }]}>
          <View style={[styles.icon, { backgroundColor: CATEGORY_COLOR.animals }]}><Icon name="paw" size={18} color="#ffffff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{herdLabel(h)}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>On the land here</Text>
          </View>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
        <View style={{ flex: 1 }}><Button title="Add objects to this area" kind="secondary" icon="link-variant-plus" disabled={!candidates.length} onPress={() => setPicking(true)} /></View>
        <View style={{ flex: 1 }}><Button title="Place a new object here" kind="secondary" icon="plus" onPress={onPlaceNew} /></View>
      </View>

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 48, backgroundColor: t.bg, flexGrow: 1 }}>
          <Button title="Done" onPress={() => setPicking(false)} />
          <Card title={`Add to ${nameOf(area)}`} icon="link-variant-plus">
            <Body muted>Tap objects to add them to this area, for example a bed that sits across the line. They stay where they are on the map.</Body>
            {candidates.length === 0 && <Body muted>Everything on the map is already in this area.</Body>}
            {candidates.map((o) => {
              const type = objectType(o.kind);
              return (
                <Pressable key={o.id} accessibilityRole="button" accessibilityLabel={`Add ${nameOf(o)} to ${nameOf(area)}`}
                  onPress={() => { tapFeedback(); onChange(linkToArea(area, o.id, true, objects)); }} style={[styles.row, styles.main, { borderColor: t.border }]}>
                  <View style={[styles.icon, { backgroundColor: o.existing ? '#757575' : CATEGORY_COLOR[type?.category ?? ''] ?? t.accent }]}>
                    <Icon name={objectIcon(o.kind, type?.category)} size={18} color="#ffffff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{nameOf(o)}</Text>
                    {type && type.name !== nameOf(o) && <Text style={{ color: t.muted, fontSize: 13 }}>{type.name}</Text>}
                  </View>
                  <Icon name="plus-circle-outline" size={22} color={t.accent} />
                </Pressable>
              );
            })}
          </Card>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 52 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  remove: { minWidth: 64, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
});
