/**
 * Step 1 — locate the property (§2.1): address search (Census, then Nominatim), "I'm standing on my
 * property" GPS, or tap on the map. Geocoding only happens when the user presses Search (no
 * autocomplete-as-you-type, per Nominatim policy).
 */
import { geocode, type GeocodeResult } from '@homeground/providers';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ParcelMap } from '../src/components/ParcelMap';
import { Body, Button, useTheme } from '../src/components/ui';
import { http } from '../src/services/http';
import { useOnboarding, type LocatedPlace } from '../src/services/onboarding';

export default function Locate() {
  const t = useTheme();
  const setPlace = useOnboarding((s) => s.setPlace);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pin, setPin] = useState<[number, number] | null>(null);

  const go = (p: LocatedPlace) => {
    setPlace(p);
    router.push('/boundary');
  };

  const search = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await geocode(http, query);
      setResults(r);
      if (r.length === 0) setMessage('No match. Try adding the town and state, or tap your property on the map.');
    } catch (e) {
      setMessage(`Search is unavailable right now (${(e as Error).message}). You can still use GPS or tap the map.`);
    } finally {
      setBusy(false);
    }
  };

  const useGps = async () => {
    setMessage(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setMessage('Location permission was not granted. You can search or tap the map instead.');
      return;
    }
    setBusy(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      go({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        label: 'My current location',
        source: 'gps',
        accuracyM: pos.coords.accuracy ?? undefined,
      });
    } catch (e) {
      setMessage(`Could not get a GPS fix (${(e as Error).message}).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.form}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          placeholder="Street address, town, state"
          placeholderTextColor={t.muted}
          returnKeyType="search"
          accessibilityLabel="Property address"
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        />
        <Button title={busy ? 'Working…' : 'Search'} onPress={search} disabled={busy || query.trim().length < 3} />
        <Button title="I'm standing on my property" kind="secondary" onPress={useGps} disabled={busy} />
        {message && <Body muted>{message}</Body>}
      </View>

      {results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(r, i) => `${r.lat},${r.lon},${i}`}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => go({ lat: item.lat, lon: item.lon, label: item.label, source: item.source, countyFips: item.countyFips, zip: item.zip })}
              style={[styles.result, { borderColor: t.border }]}
            >
              <Text style={{ color: t.text, fontSize: 16 }}>{item.label}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>
                {item.source === 'census' ? 'US Census Bureau geocoder' : '© OpenStreetMap contributors (Nominatim)'}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.mapBox}>
          <Body muted>Or tap your property on the map:</Body>
          <ParcelMap
            center={pin ?? [-98.5, 39.8]}
            zoom={pin ? 17 : 3}
            draft={pin ? [pin] : []}
            onPress={(lon, lat) => setPin([lon, lat])}
          />
          {pin && <Button title="Use this spot" onPress={() => go({ lon: pin[0], lat: pin[1], label: 'Point on map', source: 'map' })} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  form: { padding: 16, paddingBottom: 4 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  result: { padding: 16, borderBottomWidth: 1 },
  mapBox: { flex: 1, padding: 16, paddingTop: 0 },
});
