/**
 * One calendar for everything on a property: planting tasks, animal care, record due dates, planner
 * tasks, weather alerts and the user's own events. Pure: the app gathers the items; this lays them
 * out on a month grid, expands repeating events, and picks what's on a given day.
 *
 * Windows of more than a few days (a week of mite counts, or "keep water from freezing, Nov–Mar") show as a
 * title card only on the day they start, and are listed as ongoing on the days inside them, so a
 * month never drowns in the same card.
 */

export type AgendaSource = 'planting' | 'animal' | 'record' | 'task' | 'alert' | 'custom';

export interface AgendaItem {
  id: string;
  source: AgendaSource;
  title: string;
  /** A few words for the small card on the month grid (the task itself, without the crop or animal name). */
  short?: string;
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day (inclusive), when it spans several days. */
  end?: string;
  /** HH:MM, for the user's own timed events. */
  time?: string;
  /** Lines shown when the event is opened: what it's based on, where, notes. */
  details: string[];
  /** Plant or animal drawing for the card, when there is one. */
  plantId?: string;
  animalId?: string;
  /** Alerts and overdue items are shown in the warning colour. */
  urgent?: boolean;
  /** A custom event's stored id (for edit and delete). */
  customId?: string;
}

/** Windows longer than this many days appear only on their first day (and as "ongoing" inside). */
export const LONG_WINDOW_DAYS = 3;

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const isoAdd = (iso: string, days: number) => new Date(t(iso) + days * DAY).toISOString().slice(0, 10);
export const isoDiff = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);

/** Day of year → YYYY-MM-DD in `year` (day 1 = Jan 1). */
export function doyToIso(year: number, doy: number): string {
  return new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
}

/** A day-of-year window in `year`; one that wraps past New Year (Nov → Mar) ends the following year. */
export function windowToIso(year: number, start: number, end: number): { start: string; end: string } {
  const s = doyToIso(year, start);
  return { start: s, end: end >= start ? doyToIso(year, end) : doyToIso(year + 1, end) };
}

export type Repeat = 'none' | 'weekly' | 'monthly' | 'yearly';

export interface CustomEvent {
  id: string;
  parcelId: string;
  title: string;
  date: string;
  /** Optional last day for a multi-day event. */
  endDate?: string;
  time?: string;
  notes?: string;
  repeat: Repeat;
  /** Minutes before the start to remind (0 = at the time, or 8:00 on the day when there's no time). */
  remindMinutes?: number | null;
  createdAt: string;
}

/** Each occurrence of a custom event that starts within [from, to]. */
export function expandCustom(e: CustomEvent, from: string, to: string): AgendaItem[] {
  const span = e.endDate && e.endDate > e.date ? isoDiff(e.date, e.endDate) : 0;
  const make = (start: string): AgendaItem => ({
    id: `custom-${e.id}-${start}`, customId: e.id, source: 'custom', title: e.title, start, end: span ? isoAdd(start, span) : undefined, time: e.time,
    details: [...(e.notes ? [e.notes] : []), ...(e.repeat !== 'none' ? [`Repeats ${e.repeat}`] : [])],
  });
  if (e.repeat === 'none') return e.date <= to && (span ? isoAdd(e.date, span) : e.date) >= from ? [make(e.date)] : [];
  const out: AgendaItem[] = [];
  const [y0, m0, d0] = e.date.split('-').map(Number) as [number, number, number];
  for (let i = 0; i < 1000; i++) {
    let start: string;
    if (e.repeat === 'weekly') start = isoAdd(e.date, 7 * i);
    else {
      const y = e.repeat === 'yearly' ? y0 + i : y0 + Math.floor((m0 - 1 + i) / 12);
      const m = e.repeat === 'yearly' ? m0 : ((m0 - 1 + i) % 12) + 1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      start = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d0, last)).padStart(2, '0')}`; // the 31st falls back to the month's last day
    }
    if (start > to) break;
    if (start >= from || (span && isoAdd(start, span) >= from)) out.push(make(start));
  }
  return out;
}

const isLong = (i: AgendaItem) => !!i.end && isoDiff(i.start, i.end) > LONG_WINDOW_DAYS;
const order = (a: AgendaItem, b: AgendaItem) => Number(!!b.urgent) - Number(!!a.urgent) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title);

/** What's on one day: events shown on it (starting, or short and spanning it) and long windows it's inside. */
export function itemsOn(items: AgendaItem[], iso: string): { shown: AgendaItem[]; ongoing: AgendaItem[] } {
  const shown: AgendaItem[] = [], ongoing: AgendaItem[] = [];
  for (const i of items) {
    const end = i.end ?? i.start;
    if (iso < i.start || iso > end) continue;
    if (i.start === iso || !isLong(i)) shown.push(i);
    else ongoing.push(i);
  }
  return { shown: shown.sort(order), ongoing: ongoing.sort(order) };
}

export interface MonthCell { iso: string; day: number; inMonth: boolean; items: AgendaItem[]; ongoing: number }

/** A Sunday-first month grid of whole weeks (5 or 6), each day with its title cards. */
export function monthGrid(year: number, month: number, items: AgendaItem[]): MonthCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startIso = isoAdd(first.toISOString().slice(0, 10), -first.getUTCDay());
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((first.getUTCDay() + daysInMonth) / 7);
  const out: MonthCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = isoAdd(startIso, w * 7 + d);
      const on = itemsOn(items, iso);
      row.push({ iso, day: Number(iso.slice(8, 10)), inMonth: Number(iso.slice(5, 7)) === month, items: on.shown, ongoing: on.ongoing.length });
    }
    out.push(row);
  }
  return out;
}

/** Plain-language range: "Mar 28", "Mar 28 – Apr 4", or "Nov 7 – Mar 28, 2027" across years. */
export function formatRange(start: string, end?: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f = (iso: string, year = false) => `${M[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}${year ? `, ${iso.slice(0, 4)}` : ''}`;
  if (!end || end === start) return f(start);
  return `${f(start)} – ${f(end, end.slice(0, 4) !== start.slice(0, 4))}`;
}
