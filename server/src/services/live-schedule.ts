import { DateTime } from 'luxon';
import type { LiveScheduleEntry } from '../db/schema.js';

export const DEFAULT_SCHEDULE_TIMEZONE = 'Australia/Adelaide';

export interface LiveScheduleResolution {
  isLive: boolean;
  currentEntry: LiveScheduleEntry | null;
  nextEntry: LiveScheduleEntry | null;
  nextChangeAt: Date | null;
  nowAdelaide: {
    weekday: number;
    minuteOfDay: number;
    iso: string;
  };
}

function minuteOfDay(dt: DateTime): number {
  return dt.hour * 60 + dt.minute;
}

function isInsideEntry(nowLocal: DateTime, entry: LiveScheduleEntry): boolean {
  if (!entry.enabled) return false;
  if (entry.dayOfWeek !== nowLocal.weekday) return false;
  const minute = minuteOfDay(nowLocal);
  return minute >= entry.startMinute && minute < entry.endMinute;
}

function atMinute(dt: DateTime, minute: number): DateTime {
  return dt.set({
    hour: Math.floor(minute / 60),
    minute: minute % 60,
    second: 0,
    millisecond: 0,
  });
}

function nextOccurrence(
  nowLocal: DateTime,
  dayOfWeek: number,
  minute: number,
): DateTime {
  const daysUntil = (dayOfWeek - nowLocal.weekday + 7) % 7;
  let candidate = atMinute(nowLocal.plus({ days: daysUntil }), minute);
  if (candidate <= nowLocal) {
    candidate = candidate.plus({ weeks: 1 });
  }
  return candidate;
}

export function resolveLiveSchedule(
  now: Date,
  entries: LiveScheduleEntry[],
  timezone: string = DEFAULT_SCHEDULE_TIMEZONE,
): LiveScheduleResolution {
  const nowLocal = DateTime.fromJSDate(now).setZone(timezone);
  const enabledEntries = entries.filter((entry) => entry.enabled);

  const currentEntry =
    enabledEntries.find((entry) => isInsideEntry(nowLocal, entry)) ?? null;

  let nextEntry: LiveScheduleEntry | null = null;
  let nextStart: DateTime | null = null;

  for (const entry of enabledEntries) {
    if (currentEntry && entry.id === currentEntry.id) {
      // Skip the currently-active entry; its next occurrence is a week away.
      continue;
    }
    const occurrence = nextOccurrence(nowLocal, entry.dayOfWeek, entry.startMinute);
    if (!nextStart || occurrence < nextStart) {
      nextStart = occurrence;
      nextEntry = entry;
    }
  }

  let nextChangeAt: Date | null = null;
  if (currentEntry) {
    // Window is open; it closes today at endMinute Adelaide time.
    const endLocal = atMinute(nowLocal, currentEntry.endMinute);
    nextChangeAt = endLocal.toJSDate();
  } else if (nextStart) {
    nextChangeAt = nextStart.toJSDate();
  }

  return {
    isLive: currentEntry !== null,
    currentEntry,
    nextEntry,
    nextChangeAt,
    nowAdelaide: {
      weekday: nowLocal.weekday,
      minuteOfDay: minuteOfDay(nowLocal),
      iso: nowLocal.toISO() ?? now.toISOString(),
    },
  };
}
