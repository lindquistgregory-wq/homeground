/**
 * Animal drawings in the same flat, friendly style and 48 × 48 viewBox as PlantArt (prompt §5).
 * Side profiles facing right, built from simple shapes so they stay crisp at 32–96 px.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { useTheme } from './ui';

import { artForAnimal, type AnimalArtSpec } from './animalArtMap';
export { ANIMAL_ART, artForAnimal, type AnimalArtSpec, type AnimalShape } from './animalArtMap';

const BEAK = '#f2a531';
const RED = '#d8402f';
const LEG = '#e0a33b';
const DARK = '#3b3027';

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}

export function drawAnimal(a: AnimalArtSpec): ReactNode {
  const m = a.main, dk = shade(m, -0.28), alt = a.alt ?? shade(m, 0.4);
  const legs = (xs: number[], y: number, h: number, c = DARK, w = 3) => xs.map((x) => <Rect key={x} x={x} y={y} width={w} height={h} rx={1.2} fill={c} />);
  switch (a.shape) {
    case 'hen':
      return (<G>
        <Path d="M10 18 C6 22 7 30 12 31 L14 26Z" fill={dk} />
        {legs([19, 25], 35, 7, LEG, 2)}
        <Ellipse cx={22} cy={29} rx={12} ry={9} fill={m} />
        <Path d="M16 27 C20 33 27 33 30 28" stroke={dk} strokeWidth={1.6} fill="none" />
        <Circle cx={32} cy={18} r={6} fill={m} />
        <Path d="M29 12 C30 9 32 10 33 11 C34 9 36 10 36 13 Z" fill={RED} />
        <Path d="M37 17 L42 19 L37 21 Z" fill={BEAK} />
        <Path d="M35 22 C35 26 33 26 33 23 Z" fill={RED} />
        <Circle cx={34} cy={17} r={1.1} fill={DARK} />
      </G>);
    case 'turkey':
      return (<G>
        {[0, 1, 2, 3, 4].map((i) => <Ellipse key={i} cx={14 + i * 3} cy={17} rx={4} ry={11} fill={i % 2 ? alt : dk} transform={`rotate(${-40 + i * 20} ${18} ${28})`} />)}
        {legs([21, 27], 35, 7, LEG, 2)}
        <Ellipse cx={24} cy={29} rx={11} ry={8} fill={m} />
        <Path d="M33 26 C35 20 34 15 36 13" stroke="#8fb3d9" strokeWidth={3} fill="none" strokeLinecap="round" />
        <Circle cx={37} cy={12} r={3.4} fill="#8fb3d9" />
        <Path d="M39 12 L43 13 L39 14 Z" fill={BEAK} />
        <Path d="M37 14 C37 19 35 19 36 15" stroke={RED} strokeWidth={2} fill="none" />
      </G>);
    case 'duck':
      return (<G>
        {legs([20, 25], 36, 5, BEAK, 2)}
        <Path d="M7 26 C7 20 14 20 18 24 L34 24 C38 30 34 37 24 37 C13 37 7 33 7 26 Z" fill={m} />
        <Path d="M12 28 C17 31 25 31 30 28" stroke={dk} strokeWidth={1.4} fill="none" />
        <Path d="M30 25 C30 19 31 14 34 13" stroke={m} strokeWidth={6} fill="none" strokeLinecap="round" />
        <Circle cx={35} cy={13} r={5} fill={alt} />
        <Path d="M39 13 C43 13 45 15 44 16 L39 16 Z" fill={BEAK} />
        <Circle cx={36} cy={12} r={1} fill={DARK} />
      </G>);
    case 'goose':
      return (<G>
        {legs([18, 23], 37, 5, BEAK, 2)}
        <Path d="M6 28 C6 22 13 22 17 26 L30 26 C33 32 30 38 21 38 C12 38 6 34 6 28 Z" fill={m} />
        <Path d="M11 30 C16 33 23 33 27 30" stroke={alt} strokeWidth={1.4} fill="none" />
        <Path d="M27 27 C27 17 30 10 34 9" stroke={m} strokeWidth={5} fill="none" strokeLinecap="round" />
        <Circle cx={35} cy={9} r={4} fill={m} />
        <Path d="M38 8 L43 10 L38 11.5 Z" fill={BEAK} />
        <Circle cx={36} cy={8} r={0.9} fill={DARK} />
      </G>);
    case 'guinea':
      return (<G>
        {legs([20, 26], 35, 6, LEG, 2)}
        <Ellipse cx={23} cy={28} rx={13} ry={9} fill={m} />
        {[[16, 25], [21, 23], [26, 25], [19, 30], [25, 30], [30, 28], [13, 29]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={1.1} fill="#f2f2f2" />)}
        <Path d="M33 25 C35 22 35 19 36 17" stroke="#dfe7f0" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <Circle cx={37} cy={16} r={3.4} fill="#dfe7f0" />
        <Path d="M36 12 L38 9 L39 13 Z" fill="#c9a96e" />
        <Path d="M40 16 L43 17 L40 18 Z" fill={BEAK} />
        <Ellipse cx={37} cy={20} rx={1.2} ry={2} fill={RED} />
      </G>);
    case 'quail':
      return (<G>
        {legs([21, 25], 34, 5, LEG, 1.6)}
        <Ellipse cx={23} cy={28} rx={11} ry={8} fill={m} />
        {[[18, 26], [23, 25], [27, 28], [20, 30]].map(([x, y], i) => <Ellipse key={i} cx={x} cy={y} rx={1.6} ry={1} fill={dk} />)}
        <Circle cx={32} cy={21} r={5} fill={m} />
        <Path d="M36 21 L40 22 L36 23 Z" fill={DARK} />
        <Circle cx={33} cy={20} r={0.9} fill={DARK} />
        <Path d="M31 17 C31 14 33 13 34 14" stroke={DARK} strokeWidth={1.2} fill="none" />
      </G>);
    case 'rabbit':
      return (<G>
        <Ellipse cx={20} cy={31} rx={12} ry={9} fill={m} />
        <Circle cx={9} cy={30} r={3} fill="#ffffff" />
        <Circle cx={31} cy={24} r={7} fill={m} />
        <Ellipse cx={29} cy={11} rx={2.6} ry={8} fill={m} transform="rotate(-12 29 11)" />
        <Ellipse cx={34} cy={11} rx={2.6} ry={8} fill={m} transform="rotate(10 34 11)" />
        <Ellipse cx={34} cy={11} rx={1.2} ry={6} fill={alt} transform="rotate(10 34 11)" />
        <Circle cx={34} cy={23} r={1.1} fill={DARK} />
        <Circle cx={37.5} cy={26} r={1} fill={alt} />
        <Ellipse cx={24} cy={39} rx={5} ry={2} fill={shade(m, -0.12)} />
      </G>);
    case 'goat':
      return (<G>
        {legs([11, 15, 25, 29], 30, 11)}
        <Rect x={8} y={20} width={26} height={13} rx={6} fill={m} />
        <Path d="M9 21 L5 18" stroke={m} strokeWidth={2.5} strokeLinecap="round" />
        <Path d="M31 22 C33 15 35 12 38 11 C42 12 43 16 42 19 C40 22 36 23 33 24 Z" fill={m} />
        <Path d="M36 11 C35 6 33 4 31 4" stroke={alt} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Path d="M33 12 L30 10" stroke={m} strokeWidth={2.5} strokeLinecap="round" />
        <Path d="M41 19 C41 23 40 25 39 25 C38.5 23 39 21 40 19 Z" fill={alt} />
        <Circle cx={38.5} cy={14.5} r={1.1} fill={DARK} />
      </G>);
    case 'sheep':
      return (<G>
        {legs([12, 16, 25, 29], 31, 10, alt)}
        {[[12, 24], [18, 21], [25, 21], [30, 24], [15, 29], [22, 30], [29, 29], [9, 28]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={6} fill={m} />)}
        <Ellipse cx={37} cy={22} rx={5} ry={6} fill={alt} transform="rotate(20 37 22)" />
        <Ellipse cx={34} cy={17.5} rx={3} ry={1.5} fill={alt} />
        <Circle cx={38} cy={21} r={1} fill="#ffffff" />
        <Circle cx={33} cy={18} r={4} fill={m} />
      </G>);
    case 'pig':
      return (<G>
        {legs([13, 18, 26, 31], 32, 7, dk, 3.5)}
        <Ellipse cx={22} cy={27} rx={15} ry={9.5} fill={m} />
        <Path d="M7 24 C3 23 4 19 7 21" stroke={dk} strokeWidth={1.5} fill="none" />
        <Ellipse cx={38} cy={27} rx={3} ry={3.6} fill={dk} />
        <Circle cx={37.5} cy={26} r={0.7} fill={DARK} />
        <Circle cx={37.5} cy={28.5} r={0.7} fill={DARK} />
        <Path d="M30 18 L33 13 L35 19 Z" fill={dk} />
        <Circle cx={33} cy={23} r={1.1} fill={DARK} />
      </G>);
    case 'cow':
      return (<G>
        {legs([9, 13, 26, 30], 30, 11)}
        <Rect x={6} y={17} width={29} height={15} rx={5} fill={m} />
        <Ellipse cx={15} cy={21} rx={4} ry={3} fill={alt} />
        <Ellipse cx={26} cy={27} rx={3.5} ry={2.6} fill={alt} />
        <Path d="M7 18 C4 22 4 27 5 29" stroke={m} strokeWidth={2} fill="none" />
        <Rect x={32} y={13} width={10} height={13} rx={4} fill={m} />
        <Rect x={34} y={21} width={8} height={6} rx={3} fill={alt} />
        <Path d="M33 13 C31 10 30 10 29 11" stroke="#e8dcc0" strokeWidth={2} fill="none" strokeLinecap="round" />
        <Ellipse cx={30.5} cy={15} rx={2.4} ry={1.4} fill={dk} />
        <Circle cx={37} cy={17} r={1.1} fill={DARK} />
      </G>);
    case 'bee':
      return (<G>
        <Ellipse cx={20} cy={14} rx={7} ry={5} fill="#dceefa" opacity={0.9} transform="rotate(-20 20 14)" />
        <Ellipse cx={29} cy={13} rx={6} ry={4.5} fill="#dceefa" opacity={0.9} transform="rotate(15 29 13)" />
        <Ellipse cx={24} cy={28} rx={13} ry={9} fill={m} />
        <Rect x={17} y={19} width={4} height={18} rx={2} fill={alt} />
        <Rect x={25} y={19} width={4} height={18} rx={2} fill={alt} />
        <Path d="M11 28 L7 28" stroke={alt} strokeWidth={2} strokeLinecap="round" />
        <Circle cx={37} cy={26} r={5} fill={alt} />
        <Path d="M38 22 C39 18 41 17 42 16" stroke={alt} strokeWidth={1.2} fill="none" />
      </G>);
    case 'donkey':
      return (<G>
        {legs([10, 14, 25, 29], 30, 11)}
        <Rect x={7} y={19} width={27} height={13} rx={6} fill={m} />
        <Ellipse cx={20} cy={29} rx={11} ry={3} fill={alt} />
        <Path d="M30 21 C32 15 34 12 37 12 L41 18 C41 22 38 24 35 24 Z" fill={m} />
        <Ellipse cx={39} cy={21} rx={3.4} ry={3} fill={alt} />
        <Ellipse cx={33} cy={6} rx={1.8} ry={6} fill={m} transform="rotate(-15 33 6)" />
        <Ellipse cx={37} cy={6} rx={1.8} ry={6} fill={m} transform="rotate(12 37 6)" />
        <Path d="M30 13 L27 20" stroke={DARK} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx={36.5} cy={16} r={1.1} fill={DARK} />
      </G>);
    case 'llama':
      return (<G>
        {legs([10, 14, 23, 27], 31, 10, alt)}
        {[[11, 26], [17, 24], [24, 26], [14, 30], [22, 30]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={6} fill={m} />)}
        <Rect x={26} y={9} width={7} height={18} rx={3.5} fill={m} />
        <Rect x={27} y={5} width={12} height={7} rx={3.5} fill={m} />
        <Path d="M28 6 C27 2 28 0 29.5 1 C30 3 30 5 30 6 Z" fill={m} />
        <Path d="M31.5 6 C31 2 32 0 33.5 1 C34 3 34 5 34 6 Z" fill={m} />
        <Circle cx={33} cy={7.5} r={1} fill={DARK} />
        <Circle cx={38} cy={9.5} r={0.8} fill={alt} />
      </G>);
    case 'dog':
      return (<G>
        {legs([11, 15, 25, 29], 31, 9, alt, 3.5)}
        <Ellipse cx={20} cy={27} rx={13} ry={8} fill={m} />
        <Path d="M8 24 C4 22 3 17 5 15 C7 19 9 21 10 22 Z" fill={m} />
        <Circle cx={33} cy={18} r={7} fill={m} />
        <Ellipse cx={39} cy={21} rx={4} ry={3} fill={m} />
        <Circle cx={42} cy={20.5} r={1.4} fill={DARK} />
        <Ellipse cx={30} cy={18} rx={3} ry={5.5} fill={alt} transform="rotate(15 30 18)" />
        <Circle cx={35} cy={16} r={1.1} fill={DARK} />
      </G>);
    case 'cat':
      return (<G>
        <Path d="M10 32 C4 31 3 22 7 18" stroke={m} strokeWidth={3} fill="none" strokeLinecap="round" />
        <Ellipse cx={21} cy={31} rx={11} ry={8} fill={m} />
        <Ellipse cx={22} cy={34} rx={7} ry={4} fill={alt} />
        <Circle cx={32} cy={21} r={7} fill={m} />
        <Path d="M27 17 L27 9 L32 15 Z" fill={m} />
        <Path d="M33 15 L38 9 L38 17 Z" fill={m} />
        <Circle cx={30} cy={20} r={1.1} fill={DARK} />
        <Circle cx={35} cy={20} r={1.1} fill={DARK} />
        <Path d="M32 23 L33.5 24 L35 23" stroke={DARK} strokeWidth={0.9} fill="none" />
      </G>);
  }
}

/** The animal's picture on a rounded tile tinted from its own colour, like PlantArt. */
export function AnimalArt({ animalId, size = 48, art }: { animalId: string; size?: number; art?: AnimalArtSpec }) {
  const t = useTheme();
  const a = art ?? artForAnimal(animalId);
  const tint = t.dark ? shade(a.main, -0.75) : shade(a.main, 0.82);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size * 0.86} height={size * 0.86} viewBox="0 0 48 48">{drawAnimal(a)}</Svg>
    </View>
  );
}
