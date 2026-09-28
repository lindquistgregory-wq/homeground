/**
 * Sun path & ground truth (§5.1, §5.8): sun-path arcs for the solstices, equinoxes and today on a polar
 * diagram with the parcel's real terrain horizon, sunrise/sunset/solar noon, a time scrubber, and
 * "sun checks" that compare what the user sees with what the model predicts.
 */
import { daySunSamples, formatLength, horizonAt, keySunDates, sunTimes, type SunSample } from '@plotwright/core';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useEntitlements } from '../../src/billing/entitlements';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { getOrCreateDesign, recordSunCheck, sunCheckAgreement } from '../../src/db/designs';
import { getParcel, type ParcelRecord } from '../../src/db/parcels';
import { loadAnalysis, modeledSunAt, type ParcelAnalysis } from '../../src/services/analysis';
import { useSettings } from '../../src/services/settings';

const SIZE = 320;
const R = SIZE / 2 - 24;
const ARC_COLORS = ['#31688e', '#35b779', '#fde725', '#90d743', '#f28e2b'];

function toXY(azimuth: number, elevation: number): [number, number] {
  const r = (Math.max(0, 90 - elevation) / 90) * R;
  const a = (azimuth * Math.PI) / 180;
  return [SIZE / 2 + r * Math.sin(a), SIZE / 2 - r * Math.cos(a)];
}

const fmtTime = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');

export default function SunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const ent = useEntitlements((s) => s.entitlements);
  const [parcel, setParcel] = useState<ParcelRecord | null>(null);
  const [analysis, setAnalysis] = useState<ParcelAnalysis | null>(null);
  const [dayIdx, setDayIdx] = useState(4); // today
  const [timeIdx, setTimeIdx] = useState(0);
  const [agreement, setAgreement] = useState<{ total: number; agree: number } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await getParcel(id);
      if (!p) return;
      setParcel(p);
      setAgreement(await sunCheckAgreement(p.id));
      try {
        setAnalysis(await loadAnalysis(p.id, p.geometry, { canopy: ent.has('layers.canopyShade') }));
      } catch {
        /* diagram still works without terrain */
      }
    })();
  }, [id, ent]);

  const origin = analysis?.frame.origin ?? (parcel ? { lat: 0, lon: 0 } : null);
  const days = useMemo(() => [...keySunDates(new Date().getFullYear()), { label: 'Today', date: new Date() }], []);
  const arcs = useMemo(() => {
    if (!parcel || !analysis) return [];
    const c = analysis.frame.origin;
    return days.map((d) => ({ label: d.label, samples: daySunSamples(d.date, c.lat, c.lon, 10) }));
  }, [parcel, analysis, days]);

  const active: SunSample[] = arcs[dayIdx]?.samples ?? [];
  useEffect(() => {
    // Start the scrubber at the sample closest to now (today) or solar noon (other days).
    if (!active.length) return;
    const target = dayIdx === 4 ? Date.now() : +active[Math.floor(active.length / 2)]!.time;
    let best = 0;
    active.forEach((s, i) => { if (Math.abs(+s.time - target) < Math.abs(+active[best]!.time - target)) best = i; });
    setTimeIdx(best);
  }, [dayIdx, active]);

  if (!parcel || !origin) return <Body>Loading…</Body>;
  const times = analysis ? sunTimes(days[dayIdx]!.date, analysis.frame.origin.lat, analysis.frame.origin.lon) : null;
  const cur = active[timeIdx];
  const horizon = analysis?.horizon;
  const blocked = cur && horizon ? cur.elevation <= horizonAt(horizon, cur.azimuth) : false;
  const shadow10ft = cur && cur.elevation > 0 ? 3.048 / Math.tan((cur.elevation * Math.PI) / 180) : null;

  const horizonPath = horizon
    ? Array.from({ length: horizon.angles.length + 1 }, (_, k) => {
        const az = (k % horizon.angles.length) * horizon.stepDeg;
        const [x, y] = toXY(az, Math.max(0, horizon.angles[k % horizon.angles.length]!));
        return `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ') + ` M${SIZE / 2 + R},${SIZE / 2} A${R},${R} 0 1,0 ${SIZE / 2 - R},${SIZE / 2} A${R},${R} 0 1,0 ${SIZE / 2 + R},${SIZE / 2} Z`
    : null;

  const sunCheck = async (observedSun: boolean) => {
    if (!analysis) return;
    setChecking(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location permission is needed to know where you are standing.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const design = await getOrCreateDesign(parcel.id);
      const modeled = modeledSunAt(analysis, design.objects, pos.coords.latitude, pos.coords.longitude, new Date());
      await recordSunCheck({ parcelId: parcel.id, lat: pos.coords.latitude, lon: pos.coords.longitude, observedSun, modeledSun: modeled });
      setAgreement(await sunCheckAgreement(parcel.id));
      Alert.alert(
        'Sun check saved',
        modeled === null
          ? "You're outside the analysed area, so the model has no prediction for this spot."
          : modeled === observedSun
            ? 'The model agrees with what you see.'
            : `The model predicted ${modeled ? 'sun' : 'shade'} here. Check that nearby trees and buildings are in your plan with the right heights.`,
      );
    } catch (e) {
      Alert.alert('Sun check failed', (e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View style={styles.row}>
        {days.map((d, i) => (
          <Pressable key={d.label} accessibilityRole="button" accessibilityState={{ selected: dayIdx === i }} onPress={() => setDayIdx(i)}
            style={[styles.chip, { borderColor: dayIdx === i ? t.accent : t.border }]}>
            <Text style={{ color: dayIdx === i ? t.accent : t.text }}>{d.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ alignItems: 'center', marginVertical: 8 }} accessibilityLabel="Sun path diagram. North is up; the centre is straight overhead; the outer ring is the horizon.">
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={t.border} strokeWidth={1} fill="none" />
          {[30, 60].map((e) => <Circle key={e} cx={SIZE / 2} cy={SIZE / 2} r={((90 - e) / 90) * R} stroke={t.border} strokeDasharray="3,4" fill="none" />)}
          {[0, 90, 180, 270].map((az) => {
            const [x, y] = toXY(az, -8);
            const [x0, y0] = toXY(az, 0);
            return (
              <G key={az}>
                <Line x1={SIZE / 2} y1={SIZE / 2} x2={x0} y2={y0} stroke={t.border} strokeWidth={0.5} />
                <SvgText x={x} y={y + 4} fill={t.muted} fontSize={12} textAnchor="middle">{['N', 'E', 'S', 'W'][az / 90]}</SvgText>
              </G>
            );
          })}
          {horizonPath && <Path d={horizonPath} fill="#6b5b3e" fillOpacity={0.45} fillRule="evenodd" />}
          {arcs.map((a, i) =>
            a.samples.length > 1 ? (
              <Path key={a.label} d={a.samples.map((s, k) => { const [x, y] = toXY(s.azimuth, s.elevation); return `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ')}
                stroke={ARC_COLORS[i]} strokeWidth={i === dayIdx ? 3 : 1.5} strokeOpacity={i === dayIdx ? 1 : 0.6} fill="none" />
            ) : null,
          )}
          {cur && (() => { const [x, y] = toXY(cur.azimuth, cur.elevation); return <Circle cx={x} cy={y} r={8} fill={blocked ? '#9e9e9e' : '#fde725'} stroke="#000" strokeWidth={1} />; })()}
        </Svg>
      </View>

      {cur && (
        <Card title={`${days[dayIdx]!.label}, ${fmtTime(cur.time)}`}>
          <View style={[styles.row, { alignItems: 'center' }]}>
            <Button title="◀" kind="secondary" onPress={() => setTimeIdx((i) => Math.max(0, i - 1))} accessibilityHint="Ten minutes earlier" />
            <Button title="▶" kind="secondary" onPress={() => setTimeIdx((i) => Math.min(active.length - 1, i + 1))} accessibilityHint="Ten minutes later" />
          </View>
          <Body>Sun {cur.elevation.toFixed(1)}° high, bearing {cur.azimuth.toFixed(0)}° ({compass(cur.azimuth)}).{blocked ? ' Behind the hills from your land.' : ''}</Body>
          {shadow10ft !== null && <Body muted>A 10 ft (3 m) wall casts a {formatLength(3.048 / Math.tan((cur.elevation * Math.PI) / 180), units)} shadow now.</Body>}
        </Card>
      )}

      {times && (
        <Card title="Sun times (this phone's time zone)">
          <Body>Sunrise {fmtTime(times.sunrise)} · Solar noon {fmtTime(times.solarNoon)} · Sunset {fmtTime(times.sunset)}</Body>
          <Body muted>Noon sun {times.noonElevation.toFixed(1)}° high. Times are for a flat horizon; the brown band on the diagram is your real terrain horizon from USGS elevation data.</Body>
        </Card>
      )}

      <Card title="Sun check">
        <Body>Stand at a garden spot. Is it in direct sun right now?</Body>
        <View style={styles.row}>
          <Button title="Yes, direct sun" onPress={() => sunCheck(true)} disabled={checking || !analysis} />
          <Button title="No, shaded" kind="secondary" onPress={() => sunCheck(false)} disabled={checking || !analysis} />
        </View>
        {agreement && agreement.total > 0 && <Body muted>The model matched {agreement.agree} of {agreement.total} sun checks on this property.</Body>}
      </Card>
    </ScrollView>
  );
}

function compass(az: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]!;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
});
