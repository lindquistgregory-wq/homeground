/** Display formatting for sensor readings (canonical SI in, user's units out). */
import { formatTemp, type Exposure, type Metric } from '@plotwright/core';

export const EXPOSURE_LABEL: Record<Exposure, string> = { 'open-air': 'outdoors', 'shaded-air': 'outdoors, shaded', greenhouse: 'greenhouse or cold frame', soil: 'in the soil', indoor: 'indoors' };

export function formatMetric(m: Metric, v: number, units: 'imperial' | 'metric'): string {
  const imp = units === 'imperial';
  switch (m) {
    case 'temperature': case 'soilTemperature': case 'dewPoint': return formatTemp(v, units);
    case 'humidity': case 'soilMoisture': case 'battery': return `${Math.round(v)} %`;
    case 'illuminance': return v >= 1000 ? `${(v / 1000).toFixed(1)} klx` : `${Math.round(v)} lx`;
    case 'solarRadiation': return `${Math.round(v)} W/m²`;
    case 'rainDaily': case 'rain': case 'rainTotal': return imp ? `${(v / 25.4).toFixed(2)} in` : `${v.toFixed(1)} mm`;
    case 'rainRate': return imp ? `${(v / 25.4).toFixed(2)} in/h` : `${v.toFixed(1)} mm/h`;
    case 'windSpeed': case 'windGust': return imp ? `${Math.round(v / 0.44704)} mph` : `${v.toFixed(1)} m/s`;
    case 'pressure': return imp ? `${(v / 33.8639).toFixed(2)} inHg` : `${Math.round(v)} hPa`;
    case 'soilTension': return `${Math.round(v)} kPa`;
    case 'conductivity': return `${Math.round(v)} µS/cm`;
    case 'co2': return `${Math.round(v)} ppm`;
    default: return `${Math.round(v * 10) / 10}`;
  }
}


/** "aabbccddeeff", "AA-BB-CC-DD-EE-FF" or "aa:bb:…" → "AA:BB:CC:DD:EE:FF"; null if it isn't a MAC. */
export function normalizeMac(input: string): string | null {
  const hex = input.replace(/[\s:.-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}
