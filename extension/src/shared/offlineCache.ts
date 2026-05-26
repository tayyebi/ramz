import type { PasswordEntry } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PendingAction =
  | { type: 'create'; tempId: string; payload: Omit<PasswordEntry, 'id' | 'created_at' | 'updated_at'>; timestamp: number }
  | { type: 'update'; id: string; payload: Partial<PasswordEntry>; timestamp: number }
  | { type: 'delete'; id: string; timestamp: number };

export interface OfflineCacheData {
  cached_entries?: PasswordEntry[];
  cached_entries_timestamp?: number;
  pending_changes?: PendingAction[];
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function getCacheData(keys: (keyof OfflineCacheData)[]): Promise<OfflineCacheData> {
  return new Promise((resolve) =>
    chrome.storage.local.get(keys, (result) => resolve(result as OfflineCacheData)),
  );
}

function setCacheData(data: Partial<OfflineCacheData>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(data, resolve));
}

// ---------------------------------------------------------------------------
// Cached entries
// ---------------------------------------------------------------------------

/** Persist entries fetched from the server into the local cache. */
export async function cacheEntries(entries: PasswordEntry[]): Promise<void> {
  await setCacheData({
    cached_entries: entries,
    cached_entries_timestamp: Date.now(),
  });
}

/** Return cached entries (may be empty). */
export async function getCachedEntries(): Promise<PasswordEntry[]> {
  const data = await getCacheData(['cached_entries']);
  return data.cached_entries ?? [];
}

/** Return the timestamp of the last cache write, or 0 if never cached. */
export async function getCachedEntriesTimestamp(): Promise<number> {
  const data = await getCacheData(['cached_entries_timestamp']);
  return data.cached_entries_timestamp ?? 0;
}

// ---------------------------------------------------------------------------
// Pending-change queue
// ---------------------------------------------------------------------------

export async function getPendingChanges(): Promise<PendingAction[]> {
  const data = await getCacheData(['pending_changes']);
  return data.pending_changes ?? [];
}

export async function addPendingChange(action: PendingAction): Promise<void> {
  const queue = await getPendingChanges();
  queue.push(action);
  await setCacheData({ pending_changes: queue });
}

export async function clearPendingChanges(): Promise<void> {
  await setCacheData({ pending_changes: [] });
}

/** Remove a single pending action by its index. */
export async function removePendingChange(index: number): Promise<void> {
  const queue = await getPendingChanges();
  queue.splice(index, 1);
  await setCacheData({ pending_changes: queue });
}

// ---------------------------------------------------------------------------
// Local-only mutations (apply pending changes to the cached entries list so
// the user sees immediate feedback while offline)
// ---------------------------------------------------------------------------

export async function applyCachedCreate(
  tempId: string,
  payload: Omit<PasswordEntry, 'id' | 'created_at' | 'updated_at'>,
): Promise<void> {
  const entries = await getCachedEntries();
  const now = new Date().toISOString();
  entries.push({
    ...payload,
    id: tempId,
    created_at: now,
    updated_at: now,
  } as PasswordEntry);
  await cacheEntries(entries);
}

export async function applyCachedUpdate(
  id: string,
  payload: Partial<PasswordEntry>,
): Promise<void> {
  const entries = await getCachedEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx !== -1) {
    entries[idx] = { ...entries[idx], ...payload, updated_at: new Date().toISOString() };
    await cacheEntries(entries);
  }
}

export async function applyCachedDelete(id: string): Promise<void> {
  const entries = await getCachedEntries();
  await cacheEntries(entries.filter((e) => e.id !== id));
}
