import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { LiveScheduleEntry } from '../../src/db/schema.js';
import { resolveLiveSchedule } from '../../src/services/live-schedule.js';

function entry(partial: Partial<LiveScheduleEntry> & {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}): LiveScheduleEntry {
  return {
    id: partial.id ?? `entry-${partial.dayOfWeek}-${partial.startMinute}`,
    dayOfWeek: partial.dayOfWeek,
    startMinute: partial.startMinute,
    endMinute: partial.endMinute,
    enabled: partial.enabled ?? true,
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    updatedAt: partial.updatedAt ?? new Date('2026-01-01T00:00:00Z'),
  };
}

function adelaide(iso: string): Date {
  const dt = DateTime.fromISO(iso, { zone: 'Australia/Adelaide' });
  if (!dt.isValid) {
    throw new Error(`invalid test input: ${iso}`);
  }
  return dt.toJSDate();
}

describe('resolveLiveSchedule', () => {
  it('returns isLive=false and picks next entry when outside all windows', () => {
    // 2026-04-18 Sat 15:00 Adelaide — Luxon weekday=6 (Sat).
    const now = adelaide('2026-04-18T15:00:00');
    const entries = [
      entry({ dayOfWeek: 6, startMinute: 18 * 60, endMinute: 20 * 60 }), // Sat 18:00-20:00
    ];

    const result = resolveLiveSchedule(now, entries);

    expect(result.isLive).toBe(false);
    expect(result.currentEntry).toBeNull();
    expect(result.nextEntry?.id).toBe(entries[0].id);
    expect(result.nextChangeAt).not.toBeNull();

    // nextChangeAt should land at today 18:00 Adelaide.
    const changeLocal = DateTime.fromJSDate(result.nextChangeAt!).setZone('Australia/Adelaide');
    expect(changeLocal.hour).toBe(18);
    expect(changeLocal.minute).toBe(0);
    expect(changeLocal.weekday).toBe(6);
  });

  it('returns isLive=true when inside a window and nextChangeAt at its end', () => {
    const now = adelaide('2026-04-18T18:45:00'); // Sat 18:45
    const entries = [
      entry({ dayOfWeek: 6, startMinute: 18 * 60, endMinute: 20 * 60 }),
    ];

    const result = resolveLiveSchedule(now, entries);

    expect(result.isLive).toBe(true);
    expect(result.currentEntry?.id).toBe(entries[0].id);

    const changeLocal = DateTime.fromJSDate(result.nextChangeAt!).setZone('Australia/Adelaide');
    expect(changeLocal.hour).toBe(20);
    expect(changeLocal.minute).toBe(0);
  });

  it('treats startMinute inclusive and endMinute exclusive', () => {
    const entries = [
      entry({ dayOfWeek: 6, startMinute: 18 * 60, endMinute: 20 * 60 }),
    ];
    const atStart = adelaide('2026-04-18T18:00:00');
    const atEnd = adelaide('2026-04-18T20:00:00');

    expect(resolveLiveSchedule(atStart, entries).isLive).toBe(true);
    expect(resolveLiveSchedule(atEnd, entries).isLive).toBe(false);
  });

  it('handles midnight-spanning windows via two entries', () => {
    // Sat 22:00–23:59 + Sun 00:00–02:00
    const entries = [
      entry({ id: 'a', dayOfWeek: 6, startMinute: 22 * 60, endMinute: 23 * 60 + 59 }),
      entry({ id: 'b', dayOfWeek: 7, startMinute: 0, endMinute: 2 * 60 }),
    ];

    const lateSat = adelaide('2026-04-18T23:30:00');
    const earlySun = adelaide('2026-04-19T00:30:00');

    expect(resolveLiveSchedule(lateSat, entries).currentEntry?.id).toBe('a');
    expect(resolveLiveSchedule(earlySun, entries).currentEntry?.id).toBe('b');
  });

  it('respects Adelaide DST — window produces different UTC times across the year', () => {
    // Every Monday 09:00 Adelaide.
    const entries = [entry({ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 })];

    // 2026-01-05 is a Monday in Adelaide summer (ACDT = UTC+10:30).
    // 2026-07-06 is a Monday in Adelaide winter (ACST = UTC+09:30).
    const summerSun = adelaide('2026-01-04T08:00:00');   // Sun 08:00 Adelaide ACDT
    const winterSun = adelaide('2026-07-05T08:00:00');   // Sun 08:00 Adelaide ACST

    const summer = resolveLiveSchedule(summerSun, entries);
    const winter = resolveLiveSchedule(winterSun, entries);

    const summerUtc = DateTime.fromJSDate(summer.nextChangeAt!).toUTC().toISO();
    const winterUtc = DateTime.fromJSDate(winter.nextChangeAt!).toUTC().toISO();

    // Monday 09:00 ACDT = 22:30 UTC Sunday; Monday 09:00 ACST = 23:30 UTC Sunday.
    expect(summerUtc).toBe('2026-01-04T22:30:00.000Z');
    expect(winterUtc).toBe('2026-07-05T23:30:00.000Z');
  });

  it('skips disabled entries', () => {
    const entries = [
      entry({ dayOfWeek: 6, startMinute: 18 * 60, endMinute: 20 * 60, enabled: false }),
    ];
    const now = adelaide('2026-04-18T19:00:00');

    const result = resolveLiveSchedule(now, entries);

    expect(result.isLive).toBe(false);
    expect(result.nextEntry).toBeNull();
    expect(result.nextChangeAt).toBeNull();
  });

  it('advances a weekly-recurring entry past the current minute when nothing else is close', () => {
    // Only one entry, Sat 18:00–20:00. At Sat 21:00 → next occurrence is next Saturday.
    const entries = [entry({ dayOfWeek: 6, startMinute: 18 * 60, endMinute: 20 * 60 })];
    const now = adelaide('2026-04-18T21:00:00');

    const result = resolveLiveSchedule(now, entries);

    expect(result.isLive).toBe(false);
    const change = DateTime.fromJSDate(result.nextChangeAt!).setZone('Australia/Adelaide');
    expect(change.weekday).toBe(6);
    expect(change.toISODate()).toBe('2026-04-25');
    expect(change.hour).toBe(18);
  });
});
