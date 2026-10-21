/**
 * Photos of an animal or a group on the homestead: take one with the camera or choose one, up to 5,
 * the first being the profile picture. Each is compressed on the phone with location data removed;
 * only a small thumbnail syncs. Hold a photo to make it the profile picture or remove it.
 */
import { PHOTO, type AnimalRecord } from '@plotwright/core';
import { useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { deletePhotoFile, photoUri, pickAnimalPhoto, type PhotoSource } from '../services/photos';
import { Chip } from './plants';
import { Text } from './Text';
import { useTheme } from './ui';

export type AnimalPhoto = NonNullable<AnimalRecord['photos']>[number];

export function AnimalPhotos({ photos, name, onChange, compact }: {
  photos: AnimalPhoto[]; name: string; onChange: (p: AnimalPhoto[]) => void | Promise<void>; compact?: boolean;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const add = async (source: PhotoSource) => {
    setBusy(true);
    try {
      const p = await pickAnimalPhoto(source);
      if (p) await onChange([...photos, p]);
    } catch (e) {
      Alert.alert('Photo', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ask = () => Alert.alert(`Photo of ${name}`, undefined, [
    { text: 'Take a photo', onPress: () => void add('camera') },
    { text: 'Choose from library', onPress: () => void add('library') },
    { text: 'Cancel', style: 'cancel' },
  ]);

  return (
    <View style={{ marginVertical: 6 }}>
      <View style={styles.row}>
        {photos.map((p, i) => (
          <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${name}${i === 0 ? ', profile picture' : ''}`}
            accessibilityHint="Opens the photo; hold for more"
            onPress={() => setView(photoUri(p))}
            onLongPress={() => Alert.alert('Photo', undefined, [
              ...(i > 0 ? [{ text: 'Make profile picture', onPress: () => void onChange([p, ...photos.filter((x) => x.id !== p.id)]) }] : []),
              { text: 'Remove', style: 'destructive' as const, onPress: () => { deletePhotoFile(p); void onChange(photos.filter((x) => x.id !== p.id)); } },
              { text: 'Cancel', style: 'cancel' as const },
            ])}>
            <Image source={{ uri: p.thumb }} style={[compact ? styles.small : styles.thumb, i === 0 && { borderColor: t.accent, borderWidth: 2 }]} />
          </Pressable>
        ))}
        {photos.length < PHOTO.maxPerAnimal && (
          <Chip label={busy ? 'Saving photo…' : photos.length ? '+ Photo' : 'Add a photo'} active={false} disabled={busy} onPress={ask} />
        )}
      </View>
      {photos.length > 0 && !compact && <Text style={{ color: t.muted, fontSize: 12 }}>Hold a photo to remove it or make it the profile picture. Photos are compressed and location data is removed.</Text>}
      <Modal visible={!!view} transparent animationType="fade" onRequestClose={() => setView(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setView(null)} style={styles.viewer}>
          {view && <Image source={{ uri: view }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </View>
  );
}

/** A round profile picture for an animal or group, when it has one. */
export function profilePhoto(photos: AnimalPhoto[] | undefined): string | undefined {
  return photos?.[0]?.thumb;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  small: { width: 44, height: 44, borderRadius: 8 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
});
