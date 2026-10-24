// Times in the phone's own format: "4:00 PM" on a US-region phone, "16:00" on most
// others. Follows the device's 12/24-hour setting (expo-localization, in Expo Go).

import { getCalendars, getLocales } from 'expo-localization';

const locale = getLocales()[0]?.languageTag ?? 'en-US';
const h24 = getCalendars()[0]?.uses24hourClock ?? !/-(US|CA|AU|NZ|PH|IN)$/.test(locale);

let fmt: Intl.DateTimeFormat | null = null;
try {
  fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: !h24 });
} catch {
  fmt = null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A wall-clock time: clock(16, 0) → "4:00 PM" or "16:00". */
export function clock(h: number, m = 0): string {
  if (fmt) {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    const s = fmt.format(d);
    if (/\d/.test(s)) return s;
  }
  if (h24) return `${pad2(h)}:${pad2(m)}`;
  return `${h % 12 || 12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The time of a moment: timeOf(Date.now()) → "8:32 AM". */
export const timeOf = (at: number) => {
  const d = new Date(at);
  return clock(d.getHours(), d.getMinutes());
};

/** Minutes after midnight, as a time: fromMinutes(510) → "8:30 AM". */
export const fromMinutes = (min: number) => clock(Math.floor(min / 60) % 24, min % 60);

/** The next time the clock shows h:m — today if still ahead, otherwise tomorrow. */
export function nextAt(h: number, m = 0, now = Date.now()): number {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** "Today", "Tomorrow" or a weekday, for a reminder in the next week. */
export function dayOf(at: number, now = Date.now()): string {
  const a = new Date(at);
  const b = new Date(now);
  const days = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(a);
  } catch {
    return a.toDateString().slice(0, 3);
  }
}
