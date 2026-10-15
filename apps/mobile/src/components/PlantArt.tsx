/**
 * Plant pictures drawn for Plotwright: a flat-style shape per crop type (round fruit, root, leafy
 * green, pod, grain …) in the plant's own colours, on a soft tinted tile. Vector, so it stays sharp
 * at any size, works offline and needs no image licence. Decorative: the plant's name is always
 * shown next to it, so the picture is hidden from screen readers.
 */
import type { PlantSpec } from '@plotwright/core';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { artFor, type ArtSpec } from './plantArtMap';
import { useTheme } from './ui';

const LEAF = '#4f9a3a', LEAF_DARK = '#2f6b2a', STEM = '#6b4a2b';

/** Mix a hex colour toward black (f < 0) or white (f > 0). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const Shine = ({ x = 18, y = 21, rx = 4, ry = 2.6 }: { x?: number; y?: number; rx?: number; ry?: number }) => (
  <Ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#ffffff" opacity={0.35} transform={`rotate(-30 ${x} ${y})`} />
);
const Leaf = ({ d = 'M25 13 C 27 7, 34 6, 37 8 C 34 12, 29 14, 25 13 Z' }: { d?: string }) => <Path d={d} fill={LEAF} />;
const Stem = ({ d = 'M24 14 C 24 11, 25 9, 27 7' }: { d?: string }) => <Path d={d} stroke={STEM} strokeWidth={2} strokeLinecap="round" fill="none" />;
const Calyx = ({ cx = 24, cy = 14 }: { cx?: number; cy?: number }) => (
  <Path d={`M${cx} ${cy - 4} L${cx + 2} ${cy} L${cx + 7} ${cy - 1} L${cx + 3} ${cy + 2} L${cx + 5} ${cy + 6} L${cx} ${cy + 3} L${cx - 5} ${cy + 6} L${cx - 3} ${cy + 2} L${cx - 7} ${cy - 1} L${cx - 2} ${cy} Z`} fill={LEAF} />
);

function draw(a: ArtSpec): ReactNode {
  const m = a.main, dark = shade(m, -0.25), light = shade(m, 0.3);
  switch (a.shape) {
    case 'round':
      return (<G>
        <Circle cx={24} cy={28} r={14} fill={m} />
        <Path d="M24 42 A 14 14 0 0 0 38 28 A 15 15 0 0 1 24 42 Z" fill={dark} opacity={0.5} />
        <Shine />
        {a.calyx ? <Calyx /> : <><Stem /><Leaf /></>}
      </G>);
    case 'lemon':
      return (<G>
        <Path d="M8 27 C 10 21, 16 16, 24 16 C 32 16, 38 21, 40 27 C 38 33, 32 38, 24 38 C 16 38, 10 33, 8 27 Z" fill={m} />
        <Path d="M6 27 L 9 26 L 9 28 Z M42 27 L 39 26 L 39 28 Z" fill={dark} />
        <Shine x={18} y={23} />
        <Leaf d="M24 16 C 26 10, 33 9, 36 11 C 33 15, 28 17, 24 16 Z" />
      </G>);
    case 'pear':
      return (<G>
        <Path d="M24 12 C 20 12, 19 18, 19 21 C 13 25, 12 33, 15 37 C 18 42, 30 42, 33 37 C 36 33, 35 25, 29 21 C 29 18, 28 12, 24 12 Z" fill={m} />
        <Path d="M33 37 C 30 42, 18 42, 15 37 C 20 40, 28 40, 33 37 Z" fill={dark} opacity={0.5} />
        <Shine x={20} y={27} />
        {a.calyx ? <Calyx cx={24} cy={13} /> : <><Stem d="M24 13 C 24 10, 25 8, 27 6" /><Leaf d="M26 10 C 28 5, 34 4, 37 6 C 34 10, 30 11, 26 10 Z" /></>}
      </G>);
    case 'berries':
      return (<G>
        <Leaf d="M22 14 C 22 8, 29 6, 33 7 C 31 12, 26 15, 22 14 Z" />
        {[[17, 30], [31, 30], [24, 20], [24, 36]].map(([x, y], i) => (
          <G key={i}>
            <Circle cx={x} cy={y} r={7.5} fill={i === 3 ? dark : m} />
            <Circle cx={x! - 2} cy={y! - 2.5} r={1.8} fill="#ffffff" opacity={0.35} />
            <Circle cx={x} cy={y! + 3.5} r={1.4} fill={shade(m, -0.45)} opacity={0.7} />
          </G>
        ))}
      </G>);
    case 'cluster':
      return (<G>
        <Stem d="M24 12 C 24 9, 25 7, 27 6" />
        <Leaf d="M25 10 C 28 5, 35 5, 37 8 C 33 11, 29 12, 25 10 Z" />
        {[[17, 17], [24, 16], [31, 17], [20, 24], [28, 24], [17, 31] , [24, 31], [31, 31], [21, 38], [27, 38]].slice(0, 9).map(([x, y], i) => (
          <G key={i}>
            <Circle cx={x} cy={y} r={5} fill={i % 3 === 1 ? dark : m} />
            <Circle cx={x! - 1.5} cy={y! - 1.5} r={1.3} fill="#ffffff" opacity={0.3} />
          </G>
        ))}
      </G>);
    case 'cherries':
      return (<G>
        <Path d="M16 30 C 18 20, 22 14, 28 9 M32 32 C 31 22, 30 15, 28 9" stroke={LEAF_DARK} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Leaf d="M28 9 C 32 4, 39 5, 41 8 C 37 11, 32 12, 28 9 Z" />
        <Circle cx={15} cy={34} r={8} fill={m} /><Shine x={12} y={31} rx={2.6} ry={1.8} />
        <Circle cx={33} cy={35} r={8} fill={dark} /><Shine x={30} y={32} rx={2.6} ry={1.8} />
      </G>);
    case 'strawberry':
      return (<G>
        <Path d="M24 43 C 14 35, 10 27, 13 21 C 16 15, 32 15, 35 21 C 38 27, 34 35, 24 43 Z" fill={m} />
        {[[19, 24], [24, 22], [29, 24], [17, 30], [22, 29], [27, 29], [31, 30], [20, 35], [25, 35], [23, 39]].map(([x, y], i) => (
          <Ellipse key={i} cx={x} cy={y} rx={0.9} ry={1.4} fill="#f6e27a" />
        ))}
        <Path d="M24 13 L27 18 L33 16 L29 21 L24 19 L19 21 L15 16 L21 18 Z" fill={LEAF} />
        <Stem d="M24 14 C 24 11, 24 9, 25 7" />
      </G>);
    case 'bramble': {
      const pts: Array<[number, number]> = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4 - Math.abs(r - 2) * 0.5; c++) pts.push([17 + c * 4.6 + Math.abs(r - 2) * 1.2 + (r % 2) * 1.2, 20 + r * 4.6]);
      return (<G>
        {pts.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3.2} fill={i % 3 ? m : dark} />)}
        {pts.map(([x, y], i) => <Circle key={`h${i}`} cx={x - 1} cy={y - 1} r={0.9} fill="#ffffff" opacity={0.35} />)}
        <Calyx cx={24} cy={14} />
      </G>);
    }
    case 'bell':
      return (<G>
        <Path d="M15 20 C 13 30, 15 40, 21 41 C 23 41.5, 25 41.5, 27 41 C 33 40, 35 30, 33 20 C 30 16, 18 16, 15 20 Z" fill={m} />
        <Path d="M24 18 L24 41" stroke={dark} strokeWidth={1.4} opacity={0.5} />
        <Shine x={19} y={25} rx={2.5} ry={5} />
        <Path d="M20 18 C 21 15, 27 15, 28 18 Z" fill={LEAF} />
        <Path d="M24 16 C 24 12, 26 10, 28 9" stroke={LEAF_DARK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
      </G>);
    case 'chili':
      return (<G>
        <Path d="M30 14 C 35 23, 31 37, 15 42 C 13 42.5, 12 41, 14 40 C 25 33, 26 23, 24 15 Z" fill={m} />
        <Path d="M27 18 C 28 24, 26 30, 20 35" stroke="#ffffff" strokeWidth={1.6} opacity={0.3} fill="none" strokeLinecap="round" />
        <Path d="M23 15 C 24 12, 30 11, 31 14 Z" fill={LEAF} />
        <Path d="M27 12 C 27 9, 29 7, 31 6" stroke={LEAF_DARK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </G>);
    case 'carrot':
      return (<G>
        <Path d="M22 14 C 18 9, 15 7, 13 7 M24 14 C 24 9, 24 6, 25 4 M26 14 C 30 9, 33 8, 35 8" stroke={LEAF} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Path d="M16 16 C 16 14, 32 14, 32 16 L 25.5 42 C 25 44, 23 44, 22.5 42 Z" fill={m} />
        <Path d="M19 22 L23 22 M25 28 L29 28 M20 33 L23.5 33" stroke={dark} strokeWidth={1.4} strokeLinecap="round" opacity={0.6} />
      </G>);
    case 'roundroot': {
      const top = a.alt && a.alt !== '#f6f1ea' ? a.alt : undefined;
      return (<G>
        <Path d="M22 17 C 18 10, 13 8, 10 9 C 12 14, 17 17, 22 17 Z M26 17 C 30 10, 35 8, 38 9 C 36 14, 31 17, 26 17 Z" fill={LEAF} />
        <Path d="M24 17 L24 10" stroke={LEAF_DARK} strokeWidth={2} strokeLinecap="round" />
        <Circle cx={24} cy={28} r={11.5} fill={m} />
        {top && <Path d="M12.5 27 A 11.5 11.5 0 0 1 35.5 27 C 30 29, 18 29, 12.5 27 Z" fill={top} />}
        {a.alt === '#f6f1ea' && <Path d="M15 34 C 18 38, 30 38, 33 34 C 31 39, 17 39, 15 34 Z" fill={a.alt} />}
        <Path d="M24 39.5 C 24 42, 23.5 44, 22.5 45" stroke={dark} strokeWidth={1.6} strokeLinecap="round" fill="none" />
        <Shine x={19} y={24} rx={3} ry={2} />
      </G>);
    }
    case 'tuber':
      return (<G>
        <Path d="M10 28 C 10 20, 20 16, 29 18 C 38 20, 41 29, 35 35 C 29 41, 12 38, 10 28 Z" fill={m} />
        <Path d="M35 35 C 29 41, 12 38, 10 28 C 15 34, 27 37, 35 35 Z" fill={dark} opacity={0.45} />
        {[[18, 25], [27, 23], [31, 30], [21, 32]].map(([x, y], i) => <Ellipse key={i} cx={x} cy={y} rx={1.3} ry={0.9} fill={dark} />)}
        <Shine x={17} y={22} rx={3} ry={1.6} />
      </G>);
    case 'bulb':
      return (<G>
        <Path d="M24 8 C 25 14, 36 19, 36 29 C 36 37, 30 40, 24 40 C 18 40, 12 37, 12 29 C 12 19, 23 14, 24 8 Z" fill={m} />
        <Path d="M24 12 C 20 20, 19 30, 22 39 M24 12 C 28 20, 29 30, 26 39" stroke={dark} strokeWidth={1.2} fill="none" opacity={0.5} />
        <Path d="M21 40 L19 44 M24 40 L24 45 M27 40 L29 44" stroke={STEM} strokeWidth={1.2} strokeLinecap="round" />
        <Shine x={18} y={26} rx={2.4} ry={4} />
      </G>);
    case 'garlic':
      return (<G>
        <Path d="M24 7 C 25 13, 37 18, 37 29 C 37 36, 31 40, 24 40 C 17 40, 11 36, 11 29 C 11 18, 23 13, 24 7 Z" fill={m} stroke="#d8cdb8" strokeWidth={1} />
        <Path d="M24 14 C 19 21, 18 31, 21 39 M24 14 C 29 21, 30 31, 27 39 M16 21 C 14 28, 15 34, 18 38 M32 21 C 34 28, 33 34, 30 38" stroke="#c9bda5" strokeWidth={1.1} fill="none" />
        <Path d="M20 40 L19 44 M24 40 L24 45 M28 40 L29 44" stroke="#bfae8c" strokeWidth={1.2} strokeLinecap="round" />
      </G>);
    case 'stalk': {
      const top = a.alt ?? LEAF;
      // Chives and asparagus carry purple flower/tip colour in alt; other stalks carry leaf colour there.
      const flower = a.alt === '#9b6bc0' || a.alt === '#6a3f7a';
      return (<G>
        {[16, 24, 32].map((x, i) => (
          <G key={x}>
            <Rect x={x - 3} y={14 + i % 2 * 3} width={6} height={30 - i % 2 * 3} rx={3} fill={i === 1 ? a.main : shade(a.main, -0.12)} />
            {!flower && <Path d={`M${x} ${16 + i % 2 * 3} C ${x - 4} ${8}, ${x - 2} ${5}, ${x} ${3 + i} C ${x + 2} ${6}, ${x + 3} ${10}, ${x} ${16 + i % 2 * 3} Z`} fill={top} />}
            {flower && <Circle cx={x} cy={11 + i % 2 * 3} r={4} fill={a.alt} />}
          </G>
        ))}
      </G>);
    }
    case 'leafy':
      return (<G>
        {[-42, 42, -16, 16, 0].map((r, i) => (
          <G key={i} transform={`rotate(${r} 24 42)`}>
            <Path d="M24 42 C 14 34, 14 14, 24 8 C 34 14, 34 34, 24 42 Z" fill={i < 2 ? dark : i < 4 ? m : light} />
            <Path d="M24 40 L24 12" stroke={a.alt ?? shade(m, -0.4)} strokeWidth={a.alt ? 2.4 : 1.2} opacity={a.alt ? 1 : 0.6} strokeLinecap="round" />
          </G>
        ))}
      </G>);
    case 'cabbage':
      return (<G>
        <Path d="M6 30 C 6 20, 14 14, 20 18 C 14 22, 12 28, 14 36 C 10 36, 6 34, 6 30 Z M42 30 C 42 20, 34 14, 28 18 C 34 22, 36 28, 34 36 C 38 36, 42 34, 42 30 Z" fill={dark} />
        <Circle cx={24} cy={28} r={13} fill={m} />
        <Path d="M24 15 C 18 20, 18 34, 24 41 M24 15 C 30 20, 30 34, 24 41 M12 26 C 18 24, 30 24, 36 26" stroke={light} strokeWidth={1.4} fill="none" />
        <Shine x={19} y={22} rx={3} ry={2} />
      </G>);
    case 'broccoli':
      return (<G>
        <Path d="M20 30 L18 43 C 22 45, 26 45, 30 43 L28 30 Z" fill={a.alt ?? LEAF} />
        {[[16, 24], [24, 20], [32, 24], [20, 30], [28, 30], [24, 26]].map(([x, y], i) => (
          <Circle key={i} cx={x} cy={y} r={7.5} fill={i % 2 ? m : shade(m, -0.12)} />
        ))}
        {[[14, 22], [22, 17], [31, 21], [26, 27]].map(([x, y], i) => <Circle key={`d${i}`} cx={x} cy={y} r={1.4} fill={shade(m, -0.35)} opacity={0.6} />)}
      </G>);
    case 'pod':
      return (<G>
        <Path d="M8 36 C 14 22, 27 12, 41 10 C 40 16, 31 30, 13 40 C 10 41, 7 39, 8 36 Z" fill={m} />
        {[[16, 32], [22, 26], [28, 21], [34, 16]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3.4} fill={light} opacity={0.75} />)}
        <Path d="M41 10 C 42 7, 43 6, 45 5" stroke={LEAF_DARK} strokeWidth={2} strokeLinecap="round" />
      </G>);
    case 'long':
      return (<G>
        <Path d="M8 34 C 8 26, 30 12, 38 12 C 43 12, 43 17, 40 21 C 33 30, 15 40, 11 39 C 9 38.5, 8 37, 8 34 Z" fill={m} />
        <Path d="M12 33 C 20 27, 30 20, 37 15" stroke={light} strokeWidth={1.6} fill="none" opacity={0.6} strokeLinecap="round" />
        {[[16, 33], [24, 27], [31, 21]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={0.9} fill={shade(m, -0.4)} />)}
        <Path d="M39 13 C 41 10, 42 8, 44 7" stroke={LEAF_DARK} strokeWidth={2.4} strokeLinecap="round" />
      </G>);
    case 'pumpkin':
      return (<G>
        <Ellipse cx={15} cy={29} rx={9} ry={12} fill={dark} />
        <Ellipse cx={33} cy={29} rx={9} ry={12} fill={dark} />
        <Ellipse cx={24} cy={29} rx={10} ry={13} fill={m} />
        <Path d="M24 17 C 23 13, 24 10, 27 8" stroke={STEM} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Leaf d="M26 12 C 30 8, 36 8, 38 11 C 34 14, 29 14, 26 12 Z" />
        <Shine x={20} y={23} rx={2.4} ry={4} />
      </G>);
    case 'melon':
      return (<G>
        <Ellipse cx={24} cy={27} rx={16} ry={13} fill={m} />
        {a.alt && [-10, -4, 2, 8].map((dx, i) => (
          <Path key={i} d={`M${24 + dx} 14.5 C ${21 + dx} 22, ${21 + dx} 32, ${24 + dx} 39.5`} stroke={a.alt} strokeWidth={2.2} fill="none" opacity={0.85} />
        ))}
        <Shine x={16} y={21} rx={3.4} ry={2.2} />
        <Path d="M24 14 C 24 11, 26 9, 28 8" stroke={STEM} strokeWidth={2} strokeLinecap="round" fill="none" />
      </G>);
    case 'corn':
      return (<G>
        <Ellipse cx={24} cy={23} rx={7.5} ry={15} fill={m} />
        {Array.from({ length: 6 }, (_, r) => [-4, 0, 4].map((dx) => <Circle key={`${r}${dx}`} cx={24 + dx} cy={12 + r * 4.4} r={1.5} fill={shade(m, -0.18)} />))}
        <Path d="M24 44 C 16 40, 12 30, 14 18 C 18 26, 20 34, 24 38 Z" fill={LEAF} />
        <Path d="M24 44 C 32 40, 36 30, 34 18 C 30 26, 28 34, 24 38 Z" fill={LEAF_DARK} />
      </G>);
    case 'grain':
      return (<G>
        <Path d="M24 44 L24 8" stroke={shade(m, -0.2)} strokeWidth={1.8} strokeLinecap="round" />
        {Array.from({ length: 6 }, (_, i) => (
          <G key={i}>
            <Ellipse cx={20.5} cy={12 + i * 4.6} rx={2.6} ry={4} fill={m} transform={`rotate(-28 20.5 ${12 + i * 4.6})`} />
            <Ellipse cx={27.5} cy={12 + i * 4.6} rx={2.6} ry={4} fill={shade(m, -0.1)} transform={`rotate(28 27.5 ${12 + i * 4.6})`} />
          </G>
        ))}
        <Ellipse cx={24} cy={8} rx={2.4} ry={3.6} fill={m} />
        <Path d="M24 40 C 18 38, 14 34, 12 30 C 17 31, 21 34, 24 37 Z" fill={LEAF} />
      </G>);
    case 'herb':
      if (a.leaf === 'broad') return (<G>
        <Path d="M24 44 L24 14" stroke={shade(m, -0.3)} strokeWidth={2} strokeLinecap="round" />
        {[[34, -1], [26, 1], [18, -1]].map(([y, s], i) => (
          <G key={i}>
            <Ellipse cx={17} cy={y} rx={7.5} ry={5} fill={i % 2 ? m : shade(m, -0.12)} transform={`rotate(${-25 * s!} 17 ${y})`} />
            <Ellipse cx={31} cy={y! - 2} rx={7.5} ry={5} fill={i % 2 ? shade(m, -0.12) : m} transform={`rotate(${25 * s!} 31 ${y! - 2})`} />
          </G>
        ))}
        <Ellipse cx={24} cy={10} rx={5} ry={6} fill={light} />
      </G>);
      if (a.leaf === 'feather') return (<G>
        <Path d="M24 44 L24 8" stroke={shade(m, -0.3)} strokeWidth={1.8} strokeLinecap="round" />
        {Array.from({ length: 7 }, (_, i) => {
          const y = 36 - i * 4.4, w = 13 - i * 1.4;
          return <Path key={i} d={`M24 ${y} L${24 - w} ${y - 6} M${24 - w * 0.5} ${y - 3} L${24 - w * 0.7} ${y - 7} M24 ${y} L${24 + w} ${y - 6} M${24 + w * 0.5} ${y - 3} L${24 + w * 0.7} ${y - 7}`} stroke={i % 2 ? m : light} strokeWidth={1.6} strokeLinecap="round" fill="none" />;
        })}
      </G>);
      if (a.leaf === 'needle') return (<G>
        {[18, 24, 30].map((x, j) => (
          <G key={x}>
            <Path d={`M${x} 44 L${x} ${10 + (j % 2) * 4}`} stroke={shade(m, -0.35)} strokeWidth={1.6} strokeLinecap="round" />
            {Array.from({ length: 8 }, (_, i) => {
              const y = 40 - i * 3.6 - (j % 2) * 2;
              return <Path key={i} d={`M${x} ${y} L${x - 4} ${y - 3} M${x} ${y} L${x + 4} ${y - 3}`} stroke={i % 2 ? m : light} strokeWidth={1.6} strokeLinecap="round" />;
            })}
          </G>
        ))}
      </G>);
      if (a.leaf === 'frilly') return (<G>
        <Path d="M24 44 L24 26 M24 30 L15 22 M24 30 L33 22" stroke={shade(m, -0.3)} strokeWidth={1.8} strokeLinecap="round" />
        {[[15, 17], [33, 17], [24, 14], [24, 22]].map(([x, y], i) => (
          <G key={i}>
            {[0, 72, 144, 216, 288].map((r) => <Circle key={r} cx={x! + 4 * Math.cos((r * Math.PI) / 180)} cy={y! + 4 * Math.sin((r * Math.PI) / 180)} r={3.2} fill={i % 2 ? m : light} />)}
            <Circle cx={x} cy={y} r={3} fill={shade(m, -0.1)} />
          </G>
        ))}
      </G>);
      return (<G>
        <Path d="M24 44 C 24 34, 24 22, 24 10" stroke={shade(m, -0.3)} strokeWidth={2} strokeLinecap="round" fill="none" />
        {[[34, 0], [26, 1], [18, 0]].map(([y, f], i) => (
          <G key={i}>
            <Path d={`M24 ${y} C ${17 - i} ${y! - 2}, ${12 - i} ${y! - 7}, ${11 + i} ${y! - 11} C ${17} ${y! - 10}, ${22} ${y! - 6}, 24 ${y} Z`} fill={f ? m : shade(m, -0.12)} />
            <Path d={`M24 ${y} C ${31 + i} ${y! - 2}, ${36 + i} ${y! - 7}, ${37 - i} ${y! - 11} C ${31} ${y! - 10}, ${26} ${y! - 6}, 24 ${y} Z`} fill={f ? shade(m, -0.12) : m} />
          </G>
        ))}
        <Ellipse cx={24} cy={8} rx={3} ry={4.5} fill={light} />
      </G>);
    case 'lavender':
      return (<G>
        {[16, 24, 32].map((x, i) => (
          <G key={x}>
            <Path d={`M${x} 44 L${x} ${18 + i % 2 * 4}`} stroke={LEAF} strokeWidth={1.8} strokeLinecap="round" />
            {Array.from({ length: 5 }, (_, k) => <Ellipse key={k} cx={x} cy={6 + i % 2 * 4 + k * 3.2} rx={2.6} ry={2} fill={k % 2 ? m : shade(m, -0.15)} />)}
          </G>
        ))}
      </G>);
    case 'nut':
      return (<G>
        <Path d="M12 22 C 12 30, 17 41, 24 43 C 31 41, 36 30, 36 22 Z" fill={m} />
        <Path d="M36 22 C 36 30, 31 41, 24 43 C 29 38, 32 30, 32 22 Z" fill={dark} opacity={0.45} />
        <Path d="M10 22 C 10 14, 38 14, 38 22 C 32 24, 16 24, 10 22 Z" fill={shade(m, -0.4)} />
        <Path d="M14 19 L34 19 M16 16.5 L32 16.5" stroke={shade(m, -0.55)} strokeWidth={0.9} opacity={0.7} />
        <Path d="M24 15 C 24 12, 25 10, 27 9" stroke={STEM} strokeWidth={2} strokeLinecap="round" fill="none" />
        <Shine x={18} y={29} rx={2.2} ry={3.6} />
      </G>);
    case 'peanut':
      return (<G>
        <Path d="M14 15 C 8 21, 10 29, 16 30 C 18 30.5, 19 32, 19 34 C 19 41, 27 44, 32 40 C 37 36, 37 29, 32 25 C 30 23.5, 29 22, 29 20 C 28 12, 19 10, 14 15 Z" fill={m} />
        <Path d="M16 18 C 18 22, 22 24, 26 22 M21 31 C 24 35, 29 36, 33 34" stroke={dark} strokeWidth={1.2} fill="none" opacity={0.6} />
        {[[17, 22], [22, 17], [24, 35], [29, 32], [30, 38]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={0.9} fill={dark} />)}
        <Shine x={17} y={18} rx={2.4} ry={1.6} />
      </G>);
    case 'flower':
      return (<G>
        <Path d="M24 44 L24 30" stroke={LEAF} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M24 40 C 18 40, 15 36, 14 33 C 19 33, 22 36, 24 38 Z" fill={LEAF} />
        {Array.from({ length: 10 }, (_, i) => (
          <Ellipse key={i} cx={24} cy={10.5} rx={3.6} ry={7} fill={i % 2 ? a.main : shade(a.main, -0.1)} transform={`rotate(${i * 36} 24 20)`} />
        ))}
        <Circle cx={24} cy={20} r={5.5} fill={a.alt ?? '#6b4226'} />
      </G>);
    case 'clover':
      return (<G>
        <Path d="M24 44 C 24 38, 25 32, 27 27" stroke={LEAF_DARK} strokeWidth={2} strokeLinecap="round" fill="none" />
        {[[17, 30], [31, 32], [24, 38]].map(([x, y], i) => (
          <Path key={i} d={`M${x} ${y} m -6 0 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0`} fill={i === 1 ? LEAF_DARK : LEAF} opacity={0.95} />
        ))}
        {a.alt && Array.from({ length: 9 }, (_, i) => (
          <Ellipse key={`f${i}`} cx={27 + (i % 3 - 1) * 4} cy={10 + Math.floor(i / 3) * 4.5} rx={2.4} ry={3} fill={i % 2 ? a.alt : shade(a.alt!, -0.15)} />
        ))}
      </G>);
    case 'tree':
    default:
      return (<G>
        <Rect x={21} y={28} width={6} height={15} rx={2} fill={STEM} />
        <Circle cx={24} cy={21} r={14} fill={a.main} />
        <Circle cx={17} cy={18} r={2.4} fill={a.alt ?? '#d63a2f'} />
        <Circle cx={29} cy={16} r={2.4} fill={a.alt ?? '#d63a2f'} />
        <Circle cx={26} cy={26} r={2.4} fill={a.alt ?? '#d63a2f'} />
      </G>);
  }
}

/** The plant's picture on a rounded tile tinted from its own colour. */
export function PlantArt({ plant, size = 48 }: { plant: Pick<PlantSpec, 'id' | 'kind'>; size?: number }) {
  const t = useTheme();
  const a = artFor(plant.id, plant.kind);
  const tint = t.dark ? shade(a.main, -0.72) : shade(a.main, 0.85);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size * 0.86} height={size * 0.86} viewBox="0 0 48 48">{draw(a)}</Svg>
    </View>
  );
}
