/** In-app attribution & licensing screen (§11). Content comes from @homeground/data/sources. */
import { DATA_SOURCES } from '@homeground/data';
import { Linking, ScrollView, Text } from 'react-native';
import { Body, Card, useTheme } from '../src/components/ui';

export default function DataSources() {
  const t = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Body muted>
        Homeground runs on free public data. Your location, boundary and profile stay on this device and in your own iCloud
        or Google Drive. The services below receive only the coordinates or boundary needed to answer each request.
      </Body>
      {DATA_SOURCES.map((s) => (
        <Card key={s.id} title={s.name}>
          <Body>{s.provider}</Body>
          <Body muted>Used for: {s.use}</Body>
          <Body muted>Licence: {s.license}</Body>
          {s.attribution ? <Body muted>Credit: {s.attribution}</Body> : null}
          {s.caveat ? <Body muted>Note: {s.caveat}</Body> : null}
          <Text accessibilityRole="link" style={{ color: t.accent, marginTop: 6 }} onPress={() => Linking.openURL(s.url)}>
            {s.url}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}
