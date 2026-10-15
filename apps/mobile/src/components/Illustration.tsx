/**
 * Small vector illustrations drawn for Plotwright (no image files or licences involved). Colours
 * follow the theme so they sit well in light and dark mode. Decorative: hidden from screen readers.
 */
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from './ui';

/** Rolling fields under a rising sun, with planted rows: the welcome / empty-property scene. */
export function FieldScene({ width = 320, height = 170 }: { width?: number; height?: number }) {
  const t = useTheme();
  const sky = t.dark ? ['#1c2b22', '#0f1411'] : ['#dff0f7', '#f3f6f0'];
  const hillBack = t.dark ? '#24432a' : '#b9dca2';
  const hillFront = t.dark ? '#2f5a33' : '#8cc46f';
  const soil = t.dark ? '#4a3a2a' : '#a77f58';
  const row = t.dark ? '#7fbf5a' : '#3f7d2b';
  return (
    <Svg width={width} height={height} viewBox="0 0 320 170" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={sky[0]} />
          <Stop offset="1" stopColor={sky[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="320" height="170" rx="22" fill="url(#sky)" />
      <Circle cx="238" cy="62" r="26" fill={t.dark ? '#f2c14e' : '#ffcf5a'} opacity={0.95} />
      <Path d="M0 108 C 60 78, 120 92, 170 100 S 270 82, 320 96 L 320 170 L 0 170 Z" fill={hillBack} />
      <Path d="M0 128 C 70 110, 150 118, 210 126 S 290 116, 320 122 L 320 170 L 0 170 Z" fill={hillFront} />
      {/* A tilled plot with crop rows, in perspective. */}
      <Path d="M70 170 L 120 132 L 220 132 L 270 170 Z" fill={soil} />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 138 + i * 7;
        const half = 50 + i * 10;
        return <Path key={i} d={`M ${170 - half} ${y} L ${170 + half} ${y}`} stroke={row} strokeWidth={3 + i * 0.6} strokeLinecap="round" strokeDasharray={`${4 + i} ${5 + i}`} />;
      })}
    </Svg>
  );
}
