/**
 * Import readings from a CSV file (§8 "import fallback: CSV from any station software"). Columns are
 * matched by their headers and converted to canonical units; the preview shows what was recognised
 * before anything is saved.
 */
import { importCsvRows, parseCsv, METRIC_LABEL, type CsvImport, type Exposure } from '@plotwright/core';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { Chip } from '../../src/components/plants';
import { EXPOSURE_LABEL } from '../../src/components/sensorFormat';
import { Body, Button, Card, useTheme } from '../../src/components/ui';
import { deleteSensor, insertReadings, saveSensor } from '../../src/db/sensors';
import { newId } from '../../src/services/identity';
import { localOffsetMin } from '../../src/services/sensorInsights';
import { useSettings } from '../../src/services/settings';

export default function ImportCsv() {
  const { parcelId } = useLocalSearchParams<{ parcelId: string }>();
  const t = useTheme();
  const units = useSettings((s) => s.units);
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [preview, setPreview] = useState<CsvImport | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [assumed, setAssumed] = useState<'imperial' | 'metric'>(units);
  const [dayFirst, setDayFirst] = useState(false);
  const [exposure, setExposure] = useState<Exposure>('open-air');
  const [busy, setBusy] = useState(false);
  const sensorId = useState(() => newId())[0];

  // Converting a big file takes a moment on the JS thread: show a spinner first, then convert (not during render).
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setWorking('Reading the columns…');
    const h = setTimeout(() => {
      const p = importCsvRows(file.rows, { sensorId, offsetMin: localOffsetMin(), defaultUnits: assumed, dayFirst });
      if (!cancelled) { setPreview(p); setWorking(null); }
    }, 50);
    return () => { cancelled = true; clearTimeout(h); };
  }, [file, sensorId, assumed, dayFirst]);
  const span = useMemo(() => {
    if (!preview?.readings.length) return null;
    let lo = Infinity, hi = -Infinity;
    for (const r of preview.readings) (lo = Math.min(lo, r.t)), (hi = Math.max(hi, r.t));
    return [lo, hi];
  }, [preview]);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'] });
    if (r.canceled || !r.assets?.[0]) return;
    const text = await new File(r.assets[0].uri).text();
    if (text.length > 30_000_000) return Alert.alert('File too large', 'Split the export into smaller files (under ~30 MB each).');
    const name = r.assets[0].name;
    setPreview(null);
    setWorking('Opening the file…');
    // Split into rows once; unit and date choices then only re-convert.
    setTimeout(() => setFile({ name, rows: parseCsv(text) }), 50);
  };

  const save = async () => {
    if (!preview?.readings.length || !file) return;
    setBusy(true);
    const s = await saveSensor({ id: sensorId, parcelId, kind: 'csv', protocol: 'csv', vendor: 'CSV import', model: file.name, name: file.name.replace(/\.[^.]+$/, ''), exposure });
    try {
      await insertReadings(preview.readings, localOffsetMin());
      router.replace({ pathname: '/sensors/[id]', params: { id: s.id } });
    } catch (e) {
      await deleteSensor(s.id);
      Alert.alert('Import failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Body muted>Export from your station software (Ecowitt, WeatherLink, Cumulus, Weather Display, a spreadsheet…) as CSV with a date/time column. Header names and units like “Temperature (°F)” or “Rain (mm)” are recognised.</Body>
      <Button title={file ? `Chosen: ${file.name}` : 'Choose a CSV file'} kind={file ? 'secondary' : 'primary'} onPress={pick} disabled={!!working} />
      {working && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator /><Body muted>{working}</Body></View>}
      {file && preview && !working && (
        <Card title="Preview">
          <Text style={{ color: t.text, fontWeight: '600' }}>Units when a header doesn’t say</Text>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="°F, in, mph" active={assumed === 'imperial'} onPress={() => setAssumed('imperial')} />
            <Chip label="°C, mm, m/s" active={assumed === 'metric'} onPress={() => setAssumed('metric')} />
          </View>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Dates 12/31/2025" active={!dayFirst} onPress={() => setDayFirst(false)} />
            <Chip label="Dates 31/12/2025" active={dayFirst} onPress={() => setDayFirst(true)} />
          </View>
          <Body>Time column: {preview.timeColumns.join(' + ') || 'not found'}</Body>
          {preview.columns.map((c) => <Body key={c.index}>“{c.header.trim()}” → {METRIC_LABEL[c.metric]} ({c.unit})</Body>)}
          <Body>{preview.readings.length.toLocaleString()} readings from {preview.rows.toLocaleString()} rows{span ? `, ${new Date(span[0]!).toLocaleDateString()} to ${new Date(span[1]!).toLocaleDateString()}` : ''}. Times without a zone are read as this phone’s local time.</Body>
          {preview.warnings.map((w, i) => <Text key={i} style={{ color: t.warn }}>• {w}</Text>)}
          <Text style={{ color: t.text, fontWeight: '600', marginTop: 6 }}>Where were these measured?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(['open-air', 'greenhouse', 'soil', 'shaded-air'] as Exposure[]).map((e) => <Chip key={e} label={EXPOSURE_LABEL[e]} active={exposure === e} onPress={() => setExposure(e)} />)}
          </View>
          <Button title={busy ? 'Importing…' : 'Import'} onPress={save} disabled={busy || !preview.readings.length} />
        </Card>
      )}
    </ScrollView>
  );
}
