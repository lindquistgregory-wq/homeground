/**
 * Normalized sensor model (§8). Every reading is stored in SI-ish canonical units, with a UTC
 * timestamp and a quality flag, whatever the source (Bluetooth, station cloud, local network, CSV).
 */

export type Metric =
  | 'temperature' // °C, air
  | 'humidity' // % RH
  | 'dewPoint' // °C
  | 'pressure' // hPa (station/absolute as reported)
  | 'illuminance' // lx
  | 'solarRadiation' // W/m²
  | 'uvIndex'
  | 'soilMoisture' // % volumetric water content
  | 'soilTension' // kPa (centibars), tensiometers / Davis
  | 'soilTemperature' // °C
  | 'conductivity' // µS/cm (soil fertility proxy)
  | 'leafWetness' // 0–15 Davis scale or % (vendor), see sensor notes
  | 'windSpeed' // m/s
  | 'windGust' // m/s
  | 'windDirection' // degrees from north
  | 'rainRate' // mm/h
  | 'rainDaily' // mm since local midnight (station-reported)
  | 'rainTotal' // mm, cumulative counter (resets are detected downstream)
  | 'co2' // ppm
  | 'pm25' // µg/m³
  | 'battery' // %
  | 'voltage'; // V (battery)

export const METRIC_UNIT: Record<Metric, string> = {
  temperature: '°C', humidity: '%', dewPoint: '°C', pressure: 'hPa', illuminance: 'lx', solarRadiation: 'W/m²', uvIndex: '',
  soilMoisture: '%', soilTension: 'kPa', soilTemperature: '°C', conductivity: 'µS/cm', leafWetness: '', windSpeed: 'm/s', windGust: 'm/s',
  windDirection: '°', rainRate: 'mm/h', rainDaily: 'mm', rainTotal: 'mm', co2: 'ppm', pm25: 'µg/m³', battery: '%', voltage: 'V',
};

export const METRIC_LABEL: Record<Metric, string> = {
  temperature: 'Temperature', humidity: 'Humidity', dewPoint: 'Dew point', pressure: 'Pressure', illuminance: 'Light', solarRadiation: 'Solar radiation',
  uvIndex: 'UV index', soilMoisture: 'Soil moisture', soilTension: 'Soil tension', soilTemperature: 'Soil temperature', conductivity: 'Soil conductivity',
  leafWetness: 'Leaf wetness', windSpeed: 'Wind', windGust: 'Wind gust', windDirection: 'Wind direction', rainRate: 'Rain rate', rainDaily: 'Rain today',
  rainTotal: 'Rain (total)', co2: 'CO₂', pm25: 'PM2.5', battery: 'Battery', voltage: 'Battery voltage',
};

/** Physically plausible ranges; values outside are stored but flagged 'suspect'. */
export const METRIC_RANGE: Record<Metric, [number, number]> = {
  temperature: [-60, 70], humidity: [0, 100], dewPoint: [-70, 40], pressure: [500, 1100], illuminance: [0, 200_000], solarRadiation: [0, 1500],
  uvIndex: [0, 20], soilMoisture: [0, 100], soilTension: [0, 300], soilTemperature: [-40, 60], conductivity: [0, 20_000], leafWetness: [0, 100],
  windSpeed: [0, 90], windGust: [0, 120], windDirection: [0, 360], rainRate: [0, 500], rainDaily: [0, 1000], rainTotal: [0, 1e7], co2: [0, 10_000],
  pm25: [0, 2000], battery: [0, 100], voltage: [0, 20],
};

export type Quality = 'ok' | 'suspect' | 'estimated';

export interface Reading {
  sensorId: string;
  /** UTC milliseconds. */
  t: number;
  metric: Metric;
  value: number;
  quality: Quality;
}

export type MetricValues = Partial<Record<Metric, number>>;

export type SensorKind = 'ble' | 'cloud' | 'local' | 'csv';
/** Where the sensor sits, which decides what its readings mean for the plan. */
export type Exposure = 'open-air' | 'shaded-air' | 'greenhouse' | 'soil' | 'indoor';

export function qualityOf(metric: Metric, value: number): Quality {
  const [lo, hi] = METRIC_RANGE[metric];
  return Number.isFinite(value) && value >= lo && value <= hi ? 'ok' : 'suspect';
}

/** Turn decoded metric values into readings for one sensor. */
export function toReadings(sensorId: string, t: number, values: MetricValues): Reading[] {
  const out: Reading[] = [];
  for (const [m, v] of Object.entries(values) as Array<[Metric, number]>) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    out.push({ sensorId, t, metric: m, value: v, quality: qualityOf(m, v) });
  }
  return out;
}
