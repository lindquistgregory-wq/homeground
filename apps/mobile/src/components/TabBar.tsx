/**
 * Bottom tab bar on the app's main screens: Home, Plants, Calendar, Sensors and More. Switching tabs
 * keeps the history shallow (Home, then at most one tab screen), so Back always returns Home.
 */
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listParcels } from '../db/parcels';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { tapFeedback, useTheme } from './ui';

type TabKey = 'home' | 'plants' | 'calendar' | 'sensors' | 'more';
const TABS: Array<{ key: TabKey; label: string; icon: IconName; iconActive: IconName }> = [
  { key: 'home', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { key: 'plants', label: 'Plants', icon: 'sprout-outline', iconActive: 'sprout' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-blank-outline', iconActive: 'calendar-month' },
  { key: 'sensors', label: 'Sensors', icon: 'thermometer', iconActive: 'thermometer-lines' },
  { key: 'more', label: 'More', icon: 'dots-horizontal-circle-outline', iconActive: 'dots-horizontal-circle' },
];

/** The tab a path belongs to, or null on screens that have no tab bar. */
export function tabFor(path: string): TabKey | null {
  if (path === '/') return 'home';
  if (path === '/plants') return 'plants';
  if (/^\/calendar\/[^/]+$/.test(path)) return 'calendar';
  if (path === '/sensors') return 'sensors';
  if (path === '/settings') return 'more';
  return null;
}

/** Stack route names (as in app/_layout) that show the tab bar. */
export const TAB_ROUTES = new Set(['index', 'plants/index', 'calendar/[id]', 'sensors/index', 'settings']);

async function open(key: TabKey, from: TabKey) {
  if (key === 'home') {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/');
    return;
  }
  let href: Parameters<typeof router.push>[0];
  if (key === 'calendar') {
    // The calendar belongs to a property; with none yet, the tab starts the add-property flow.
    const parcel = (await listParcels())[0];
    href = parcel ? { pathname: '/calendar/[id]', params: { id: parcel.id } } : '/locate';
  } else href = key === 'plants' ? '/plants' : key === 'sensors' ? '/sensors' : '/settings';
  if (from === 'home') router.push(href);
  else router.replace(href);
}

export function TabBar() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const current = tabFor(usePathname());
  if (!current) return null;
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: Math.max(insets.bottom, 6) }]}
    >
      {TABS.map((tab) => {
        const active = tab.key === current;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => { if (!active) { tapFeedback(); void open(tab.key, current); } }}
            style={styles.tab}
          >
            <View collapsable={false} style={[styles.iconWell, { backgroundColor: active ? t.accentSoft : 'transparent' }]}>
              <Icon name={active ? tab.iconActive : tab.icon} size={22} color={active ? t.accent : t.muted} />
            </View>
            <Text style={[styles.label, { color: active ? t.accent : t.muted }, active && { fontWeight: '600' }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52, gap: 2 },
  iconWell: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12 },
});
