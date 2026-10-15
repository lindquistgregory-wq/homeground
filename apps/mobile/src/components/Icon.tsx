/**
 * App icons, from the Material Community Icons set bundled with @expo/vector-icons (MIT; drawn
 * from the font in the app, no network). Decorative icons are hidden from screen readers; the
 * control around them carries the label.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
