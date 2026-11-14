import { useEffect, useMemo, useRef, useState } from 'react';
import type { DetectionEvent } from '../types';
import { snapshotUrl } from '../api';
import { Chip, EmptyState, Field, Meter, SkeletonRows } from './ui';

export function isRestrictedAlert(event: DetectionEvent): boolean {
  return event.decision === 'REVIEW_REQUIRED' || event.alerts.includes('RESTRICTED_ZONE_DETECTED');
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function confidenceTone(conf: number): string {
  if (conf >= 0.8) return 'var(--ok)';
  if (conf >= 0.5) return 'var(--warn)';
  return 'var(--bad)';
}

export function isKnownPerson(name: string | null | undefined): boolean {
  return !!name && name.trim() !== '' && name.trim().toLowerCase() !== 'unknown';
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export default function EventsTable({
  events,
  loading,
  cameras,
}: {
  events: DetectionEvent[];
  loading: boolean;
  /**
   * Cameras known to the console, wired by the parent. Lets the empty state
   * tell "no cameras reporting" from "no detections yet". While it is
   * omitted, the empty state falls back to the generic message.
   */
  cameras?: string[];
}) {
  const [zoneFilter, setZoneFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');
  const [personFilter, setPersonFilter] = useState<string | null>(null);

  // Stable row order: newest event id first, so a live refresh never
  // reorders rows under the cursor.
  const sorted = useMemo(() => [...events].sort((a, b) => b.id - a.id), [events]);

  // Only rows that are new since the previous poll play the entrance
  // animation. Seen ids are recorded in an effect, so a double render
  // never marks a row as seen before it is painted.
  const seenIdsRef = useRef<Set<number>>(new Set());
  const newIds = useMemo(() => {
    const fresh = new Set<number>();
    for (const e of sorted) {
      if (!seenIdsRef.current.has(e.id)) fresh.add(e.id);
    }
    return fresh;
  }, [sorted]);
  useEffect(() => {
    for (const e of sorted) seenIdsRef.current.add(e.id);
  }, [sorted]);

  // Filter options come from the events already fetched, never from a
  // hardcoded list, so a zone or decision that never occurs never appears.
  const zones = useMemo(() => uniqueSorted(sorted.map((e) => e.zone)), [sorted]);
  const decisions = useMemo(() => uniqueSorted(sorted.map((e) => e.decision)), [sorted]);

  const filtered = useMemo(
    () =>
      sorted.filter(
        (e) =>
          (zoneFilter === '' || e.zone === zoneFilter) &&
          (decisionFilter === '' || e.decision === decisionFilter) &&
          (personFilter === null || e.person_name === personFilter),
      ),
    [sorted, zoneFilter, decisionFilter, personFilter],
  );

  const filtersActive = zoneFilter !== '' || decisionFilter !== '' || personFilter !== null;
  const clearFilters = () => {
    setZoneFilter('');
    setDecisionFilter('');
    setPersonFilter(null);
  };

  if (loading && events.length === 0) {
    return <SkeletonRows rows={6} height={52} />;
  }

  if (events.length === 0) {
    const body =
      cameras === undefined
        ? 'Vision events will stream in here as cameras report detections. Use the injector below to send a test event.'
        : cameras.length === 0
          ? 'No cameras are reporting yet. Connect a camera and detections will stream in here. Use the injector below to send a test event.'
          : 'Cameras are reporting but no detections have been recorded yet. Use the injector below to send a test event.';
    return <EmptyState title="No events yet" body={body} />;
  }

  return (
    <>
      <div className="form-row" style={{ marginBottom: 14 }} role="group" aria-label="Filter events">
        <Field label="Zone">
          <select
            className="select"
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            aria-label="Filter events by zone"
          >
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Decision">
          <select
            className="select"
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            aria-label="Filter events by decision"
          >
            <option value="">All decisions</option>
            {decisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        {personFilter !== null && (
          <Field label="Person">
            <Chip tone="signal">{personFilter}</Chip>
          </Field>
        )}
        {filtersActive && (
          <>
            <button type="button" className="btn" onClick={clearFilters}>
              Clear filters
            </button>
            <span className="section-meta">
              Showing {filtered.length} of {sorted.length} events
            </span>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No matching events"
          body="No events match the current filters. Clear the filters to see the full ledger."
          action={
            <button type="button" className="btn" onClick={clearFilters}>
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="table-wrap table-wrap-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>ID</th>
                <th>Time</th>
                <th>Camera</th>
                <th>Track</th>
                <th>Person</th>
                <th>Snapshot</th>
                <th>Objects</th>
                <th>Confidence</th>
                <th>Zone</th>
                <th>Decision</th>
                <th>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const alert = isRestrictedAlert(e);
                const unknown = !isKnownPerson(e.person_name);
                const isNew = newIds.has(e.id);
                return (
                  <tr
                    key={e.id}
                    className={isNew ? `sheet-row${alert ? ' row-alert' : ''}` : alert ? 'row-alert' : undefined}
                    style={
                      {
                        ...(isNew ? { '--i': Math.min(i, 24) } : {}),
                        ...(unknown && !alert ? { backgroundColor: 'var(--cloud)' } : {}),
                      } as React.CSSProperties
                    }
                  >
                    <td className="num">{e.id}</td>
                    <td className="num">{formatTimestamp(e.timestamp)}</td>
                    <td className="id">{e.camera_id}</td>
                    <td className="id">{e.track_id}</td>
                    <td>
                      {isKnownPerson(e.person_name) ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPersonFilter((cur) => (cur === e.person_name ? null : (e.person_name ?? null)))
                          }
                          aria-pressed={personFilter === e.person_name}
                          title={`Filter ledger to ${e.person_name}`}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            cursor: 'pointer',
                            font: 'inherit',
                            textAlign: 'left',
                          }}
                        >
                          <Chip tone="signal">
                            {e.person_name}
                            {typeof e.person_name_confidence === 'number' &&
                              Number.isFinite(e.person_name_confidence) && (
                                <span className="num" style={{ marginLeft: 6 }}>
                                  {e.person_name_confidence.toFixed(2)}
                                </span>
                              )}
                          </Chip>
                        </button>
                      ) : (
                        <Chip tone="idle">Unknown</Chip>
                      )}
                    </td>
                    <td>
                      {e.snapshot_path ? (
                        <a
                          href={snapshotUrl(e.snapshot_path)}
                          target="_blank"
                          rel="noreferrer"
                          title="Open full snapshot"
                        >
                          <img
                            src={snapshotUrl(e.snapshot_path)}
                            alt={`Snapshot for event ${e.id}`}
                            loading="lazy"
                            style={{
                              width: 64,
                              height: 40,
                              objectFit: 'cover',
                              borderRadius: 4,
                              border: '1px solid var(--rule)',
                              display: 'block',
                            }}
                          />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>-</span>
                      )}
                    </td>
                    <td>{e.objects.join(', ')}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <Meter value={e.confidence} max={1} color={confidenceTone(e.confidence)} label={`Confidence ${e.confidence.toFixed(2)}`} />
                        <span className="num">{e.confidence.toFixed(2)}</span>
                      </span>
                    </td>
                    <td><Chip tone={e.zone === 'RESTRICTED' ? 'bad' : 'idle'}>{e.zone}</Chip></td>
                    <td>
                      <Chip tone={e.decision === 'REVIEW_REQUIRED' ? 'warn' : 'ok'}>{e.decision}</Chip>
                    </td>
                    <td className="id">{e.alerts.length > 0 ? e.alerts.join(', ') : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
