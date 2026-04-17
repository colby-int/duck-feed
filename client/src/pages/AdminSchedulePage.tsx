import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Panel } from '../components/Panel';
import {
  createLiveScheduleEntry,
  deleteLiveScheduleEntry,
  getLiveSource,
  getStreamSnapshot,
  listLiveSchedule,
  updateLiveScheduleEntry,
  updateLiveSource,
  type LiveScheduleEntry,
  type LiveSourceRecord,
  type StreamSnapshot,
} from '../api/client';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_STEP_MINUTES = 30;
const HOURS_PER_DAY = 24;
const SLOTS_PER_DAY = (HOURS_PER_DAY * 60) / HOUR_STEP_MINUTES;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function minuteToHHMM(minute: number): string {
  if (minute >= 24 * 60) return '24:00';
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${pad(h)}:${pad(m)}`;
}

function hhmmToMinute(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => Number.parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function entryForSlot(
  entries: LiveScheduleEntry[],
  dayOfWeek: number,
  slotIndex: number,
): LiveScheduleEntry | null {
  const startMinute = slotIndex * HOUR_STEP_MINUTES;
  return (
    entries.find(
      (entry) =>
        entry.enabled &&
        entry.dayOfWeek === dayOfWeek &&
        entry.startMinute <= startMinute &&
        entry.endMinute > startMinute,
    ) ?? null
  );
}

export function AdminSchedulePage() {
  const [source, setSource] = useState<LiveSourceRecord | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceDisplayName, setSourceDisplayName] = useState('');
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState(false);

  const [entries, setEntries] = useState<LiveScheduleEntry[]>([]);
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const [newDayOfWeek, setNewDayOfWeek] = useState(6);
  const [newStart, setNewStart] = useState('18:00');
  const [newEnd, setNewEnd] = useState('20:00');
  const [newNote, setNewNote] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [sourceRecord, scheduleRows, streamSnapshot] = await Promise.all([
          getLiveSource(),
          listLiveSchedule(),
          getStreamSnapshot(),
        ]);
        setSource(sourceRecord);
        setSourceUrl(sourceRecord?.url ?? '');
        setSourceDisplayName(sourceRecord?.displayName ?? '');
        setEntries(scheduleRows);
        setSnapshot(streamSnapshot);
      } catch (err) {
        setLoadingError(err instanceof Error ? err.message : 'Failed to load schedule');
      }
    };
    void load();
  }, []);

  const nowPosition = useMemo(() => {
    if (!snapshot) return null;
    const parsed = new Date(snapshot.live.nowAdelaide);
    if (Number.isNaN(parsed.getTime())) return null;
    // nowAdelaide is an ISO with offset — Luxon serialises in-zone.
    // We can pull out weekday + minute-of-day from the ISO string directly
    // to avoid reintroducing browser TZ math.
    const iso = snapshot.live.nowAdelaide;
    const [datePart, timePart] = iso.split('T');
    if (!datePart || !timePart) return null;
    const [y, mo, d] = datePart.split('-').map((v) => Number.parseInt(v, 10));
    const [h, m] = timePart.split(':').map((v) => Number.parseInt(v, 10));
    if (![y, mo, d, h, m].every(Number.isFinite)) return null;
    // Compute Luxon-style weekday (1 = Mon .. 7 = Sun) from a local date.
    // Zeller-style: build a UTC date from the local y/mo/d and read getUTCDay()
    // which ignores the TZ offset — this gives us the Adelaide-local weekday.
    const utc = new Date(Date.UTC(y, mo - 1, d));
    const jsDay = utc.getUTCDay(); // 0=Sun..6=Sat
    const weekday = jsDay === 0 ? 7 : jsDay;
    return { weekday, minute: h * 60 + m };
  }, [snapshot]);

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSource(true);
    setSourceError(null);
    setSourceMessage(null);
    try {
      const next = await updateLiveSource({
        url: sourceUrl.length === 0 ? null : sourceUrl,
        displayName: sourceDisplayName.length === 0 ? null : sourceDisplayName,
      });
      setSource(next);
      setSourceMessage('Live source saved');
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Failed to save live source');
    } finally {
      setSavingSource(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const start = hhmmToMinute(newStart);
      const end = hhmmToMinute(newEnd);
      if (end <= start) {
        throw new Error('End time must be after start time');
      }
      const created = await createLiveScheduleEntry({
        dayOfWeek: newDayOfWeek,
        startMinute: start,
        endMinute: end,
        note: newNote.length === 0 ? null : newNote,
      });
      setEntries((prev) => [...prev, created]);
      setNewNote('');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create entry');
    } finally {
      setCreating(false);
    }
  }

  async function toggleEntry(entry: LiveScheduleEntry) {
    const updated = await updateLiveScheduleEntry(entry.id, { enabled: !entry.enabled });
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)));
  }

  async function removeEntry(id: string) {
    await deleteLiveScheduleEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const activeEntries = useMemo(
    () => [...entries].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute),
    [entries],
  );

  return (
    <div className="space-y-6">
      <Panel title="Live source" subtitle="URL + name">
        <form className="space-y-4" onSubmit={(event) => void saveSource(event)}>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">
              Stream URL
            </span>
            <input
              className="w-full bg-white px-3 py-2 font-mono text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/live.mp3"
              type="url"
              value={sourceUrl}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">
              Display name
            </span>
            <input
              className="w-full bg-white px-3 py-2 text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setSourceDisplayName(event.target.value)}
              placeholder="Saturday Live"
              value={sourceDisplayName}
            />
          </label>
          <button
            className="bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink"
            disabled={savingSource}
            type="submit"
          >
            {savingSource ? 'Saving…' : 'Save live source'}
          </button>
          {source?.updatedAt ? (
            <div className="text-xs text-ink/60">
              Last updated {new Date(source.updatedAt).toLocaleString()}
            </div>
          ) : null}
          {sourceMessage ? <p className="text-sm text-green-700">{sourceMessage}</p> : null}
          {sourceError ? <p className="text-sm text-red-700">{sourceError}</p> : null}
        </form>
      </Panel>

      <Panel
        title="Weekly schedule"
        subtitle={`Adelaide time${snapshot ? ` — now ${snapshot.live.nowAdelaide.slice(11, 16)}` : ''}`}
      >
        {loadingError ? <p className="mb-4 text-sm text-red-700">{loadingError}</p> : null}

        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="grid grid-cols-[48px_repeat(7,minmax(80px,1fr))] text-[0.68rem] uppercase tracking-[0.18em] text-ink/60">
              <div />
              {DAY_NAMES.map((name) => (
                <div key={name} className="px-1 py-1 text-center">
                  {name}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[48px_repeat(7,minmax(80px,1fr))]">
              <div className="flex flex-col">
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) => {
                  const isHourStart = i % 2 === 0;
                  return (
                    <div
                      key={i}
                      className="h-4 text-right pr-1 text-[0.62rem] text-ink/50 leading-4"
                    >
                      {isHourStart ? minuteToHHMM(i * HOUR_STEP_MINUTES) : ''}
                    </div>
                  );
                })}
              </div>
              {DAY_NAMES.map((_name, dayIdx) => {
                const dayOfWeek = dayIdx + 1;
                return (
                  <div key={dayOfWeek} className="relative border-l border-ink/10">
                    {Array.from({ length: SLOTS_PER_DAY }, (_, slotIdx) => {
                      const entry = entryForSlot(entries, dayOfWeek, slotIdx);
                      const nowHere =
                        nowPosition?.weekday === dayOfWeek &&
                        nowPosition.minute >= slotIdx * HOUR_STEP_MINUTES &&
                        nowPosition.minute < (slotIdx + 1) * HOUR_STEP_MINUTES;
                      return (
                        <div
                          key={slotIdx}
                          className={[
                            'h-4 border-b border-ink/5 transition-colors',
                            entry
                              ? entry.enabled
                                ? 'bg-[#00ff3a]/30'
                                : 'bg-[#00ff3a]/10'
                              : '',
                            nowHere ? 'outline outline-1 outline-[#ff4d4d]' : '',
                          ].join(' ')}
                          title={entry?.note ?? undefined}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Entries</div>
          <ul className="mt-2 divide-y divide-ink/10">
            {activeEntries.length === 0 ? (
              <li className="py-3 text-sm text-ink/60">No schedule entries yet.</li>
            ) : (
              activeEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-4">
                    <span className="inline-block w-10 font-medium uppercase tracking-[0.14em]">
                      {DAY_NAMES[entry.dayOfWeek - 1]}
                    </span>
                    <span className="font-mono">
                      {minuteToHHMM(entry.startMinute)} – {minuteToHHMM(entry.endMinute)}
                    </span>
                    {entry.note ? <span className="text-ink/70">{entry.note}</span> : null}
                    {!entry.enabled ? (
                      <span className="bg-ink/10 px-2 py-0.5 text-[0.64rem] uppercase tracking-[0.18em] text-ink/60">
                        disabled
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="bg-panel px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-white"
                      onClick={() => void toggleEntry(entry)}
                      type="button"
                    >
                      {entry.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="bg-red-700 px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.18em] text-white"
                      onClick={() => void removeEntry(entry.id)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <form
          className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[auto_auto_auto_1fr_auto] md:items-end"
          onSubmit={(event) => void handleCreate(event)}
        >
          <label className="block">
            <span className="mb-1 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Day</span>
            <select
              className="bg-white px-2 py-2 text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setNewDayOfWeek(Number.parseInt(event.target.value, 10))}
              value={newDayOfWeek}
            >
              {DAY_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Start</span>
            <input
              className="bg-white px-2 py-2 font-mono text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setNewStart(event.target.value)}
              type="time"
              value={newStart}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">End</span>
            <input
              className="bg-white px-2 py-2 font-mono text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setNewEnd(event.target.value)}
              type="time"
              value={newEnd}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Note</span>
            <input
              className="w-full bg-white px-2 py-2 text-sm shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
              onChange={(event) => setNewNote(event.target.value)}
              placeholder="(optional)"
              value={newNote}
            />
          </label>
          <button
            className="bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink"
            disabled={creating}
            type="submit"
          >
            {creating ? 'Adding…' : 'Add window'}
          </button>
        </form>
        {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
      </Panel>
    </div>
  );
}
