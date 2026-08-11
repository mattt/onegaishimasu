import { type Entry, PINNABLE_FIELDS, type PinnableField } from "../entry.js";

/**
 * Report which fields diverge between what the generator wrote and the current snapshot.
 * Pinning is detected, not declared: any divergence is a human edit.
 */
export function detectPins(original: Entry, current: Entry): PinnableField[] {
  const pinned: PinnableField[] = [];
  for (const field of PINNABLE_FIELDS) {
    if (original[field] !== current[field]) {
      pinned.push(field);
    }
  }
  return pinned;
}

/** Union a set of newly detected pins into an entry's pinned list. */
export function mergePinned(entry: Entry, newlyPinned: PinnableField[]): Entry {
  const set = new Set<PinnableField>([...entry.pinned, ...newlyPinned]);
  return { ...entry, pinned: [...set] };
}

/** Apply a regeneration while keeping every pinned field from the existing entry. */
export function applyPins(generated: Entry, existing: Entry): Entry {
  const result: Entry = { ...generated, pinned: [...existing.pinned] };
  for (const field of existing.pinned) {
    (result[field] as Entry[PinnableField]) = existing[field];
  }
  return result;
}
