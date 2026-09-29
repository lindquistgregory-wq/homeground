/** Small line chart for sensor readings (react-native-svg). Shows min/max band for daily data. */
import { View, Text } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { useTheme } from './ui';

export interface ChartPoint { t: number; v: number; lo?: number; hi?: number }

export function SensorChart({ points, format, width = 320, height = 140, label }: { points: ChartPoint[]; format: (v: number) => string; width?: number; height?: number; label: string }) {
  const t = useTheme();
  if (points.length < 2) return <Text style={{ color: t.muted }}>Not enough readings to chart yet.</Text>;
  const t0 = points[0]!.t, t1 = points[points.length - 1]!.t;
  const vals = points.flatMap((p) => [p.v, p.lo ?? p.v, p.hi ?? p.v]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) (lo -= 1), (hi += 1);
  const pad = 6;
  const X = (x: number) => pad + ((x - t0) / Math.max(1, t1 - t0)) * (width - 2 * pad);
  const Y = (y: number) => pad + (1 - (y - lo) / (hi - lo)) * (height - 2 * pad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const band = points.some((p) => p.lo !== undefined)
    ? `${points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.hi ?? p.v).toFixed(1)}`).join(' ')} ${[...points].reverse().map((p) => `L${X(p.t).toFixed(1)},${Y(p.lo ?? p.v).toFixed(1)}`).join(' ')} Z`
    : null;
  const last = points[points.length - 1]!;
  return (
    <View accessible accessibilityLabel={`${label}: from ${format(lo)} to ${format(hi)}, latest ${format(last.v)}`}>
      <Svg width={width} height={height}>
        <Line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke={t.border} />
        {band && <Path d={band} fill={t.accent} opacity={0.18} />}
        <Path d={line} stroke={t.accent} strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.muted, fontSize: 12 }}>low {format(lo)}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>high {format(hi)}</Text>
      </View>
    </View>
  );
}
