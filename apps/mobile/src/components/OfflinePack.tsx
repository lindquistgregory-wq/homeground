import { PACK_BUFFER_M, type PackPlan } from '@plotwright/core';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useEntitlements } from '../billing/entitlements';
import { deletePack, downloadPack, getPack, planForParcel, type PackInfo, type PackProgress } from '../services/offlinePacks';
import { Body, Button, Card } from './ui';

/** Offline parcel pack card for the Site Profile screen (Homestead Pro). */
export function OfflinePackCard({ parcelId, onChange }: { parcelId: string; onChange?: (p: PackInfo | undefined) => void }) {
  const ent = useEntitlements((s) => s.entitlements);
  const [pack, setPack] = useState<PackInfo | undefined>(undefined);
  const [plan, setPlan] = useState<PackPlan | undefined>(undefined);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const signal = useRef({ cancelled: false });

  useEffect(() => {
    void getPack(parcelId).then((p) => { setPack(p); onChange?.(p); });
    void planForParcel(parcelId).then(setPlan);
    return () => { signal.current.cancelled = true; };
  }, [parcelId, onChange]);

  const allowed = ent.has('offline.parcelPacks');
  const start = async () => {
    signal.current = { cancelled: false };
    setProgress({ done: 0, total: plan?.totalTiles ?? 0, stage: 'tiles' });
    try {
      const p = await downloadPack(parcelId, setProgress, signal.current);
      setPack(p);
      onChange?.(p);
      if (!p.complete) Alert.alert('Saved with gaps', 'Some map tiles couldn’t be downloaded. Tap Update pack on a better connection to fill them in.');
    } catch (e) {
      if (!signal.current.cancelled) Alert.alert('Download stopped', (e as Error).message);
      setPack(await getPack(parcelId));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card title="Offline pack">
      <Body muted>
        Saves aerial imagery for this property (plus a {PACK_BUFFER_M} m margin) and a fresh Site Profile, so the map and profile work
        without signal. Design, plant guide, sensors and the planner already work offline.
      </Body>
      {plan && <Body muted>About {plan.totalTiles.toLocaleString()} map tiles, roughly {plan.estimatedMb} MB{plan.trimmed ? ' (the deepest zoom was trimmed for this large property)' : ''}.</Body>}
      {pack?.cleared && <Body>Your phone cleared the saved maps to free up space. Tap Update pack to download them again.</Body>}
      {pack && !pack.cleared && <Body>{pack.complete ? 'Saved' : 'Partly saved'} {new Date(pack.createdAt).toLocaleDateString()} · {pack.layers.map((l) => `${l.saved.toLocaleString()} of ${l.tiles.toLocaleString()} imagery tiles`).join(', ')}</Body>}
      {progress && <Body>{progress.stage === 'tiles' ? `Downloading ${progress.done}/${progress.total}…` : 'Updating the Site Profile…'}</Body>}
      {!allowed ? (
        <Button title="Offline packs are part of Homestead Pro" kind="secondary" onPress={() => router.push({ pathname: '/paywall', params: { feature: 'offline.parcelPacks', source: 'offline' } })} />
      ) : progress ? (
        <Button title="Stop" kind="secondary" onPress={() => { signal.current.cancelled = true; }} />
      ) : (
        <>
          <Button title={pack ? 'Update pack' : 'Save for offline use'} onPress={start} />
          {pack && <Button title="Delete pack" kind="secondary" onPress={async () => { await deletePack(parcelId); setPack(undefined); onChange?.(undefined); }} />}
        </>
      )}
    </Card>
  );
}
