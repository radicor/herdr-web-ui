/**
 * The disconnected-input draft: while the socket is down, typed text is held for the
 * user to review and send after reconnect instead of being queued and fired blindly.
 * Pure logic, DOM-free, so the policy is unit-testable (see draft.test.ts).
 */

export interface InputDraft {
  readonly text: string;
  /** special keys (Enter, arrows, ^C, ...) received while disconnected - undraftable, counted */
  readonly droppedSpecial: number;
}

export const EMPTY_DRAFT: InputDraft = { text: "", droppedSpecial: 0 };
const MAX_DRAFT_CHARS = 1024;

/**
 * How long held input stays in the browser profile once it has been written there. The draft is
 * kept so a reload in the middle of a disconnect does not lose what the user typed; a day is far
 * longer than that, and short enough that text typed at a password prompt is not left lying
 * about afterwards. A record without a timestamp (one written before this) is dropped on read:
 * its age is unknown, and unknown is not "recent".
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** What a stored draft record holds: the draft, and when it was written. */
interface StoredDraft extends InputDraft { at: number }

/**
 * The draft a stored record restores, or the empty one: malformed, undated and expired records
 * all read as nothing held, so a hand-edited or stale entry cannot put text back on screen.
 */
export function restoreDraft(raw: string | null, now: number): InputDraft {
  if (raw === null) return EMPTY_DRAFT;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return EMPTY_DRAFT; }
  if (typeof value !== "object" || value === null) return EMPTY_DRAFT;
  const { text, droppedSpecial, at } = value as Partial<StoredDraft>;
  if (typeof text !== "string" || typeof droppedSpecial !== "number" || !Number.isInteger(droppedSpecial)) return EMPTY_DRAFT;
  if (typeof at !== "number" || !Number.isFinite(at) || now - at > DRAFT_TTL_MS) return EMPTY_DRAFT;
  return { text, droppedSpecial };
}

/** An IME commit can contain several code points. Never preserve terminal control sequences. */
function isPrintableChar(data: string): boolean {
  return data.length > 0 && !/[\x00-\x1f\x7f-\x9f]/u.test(data);
}

/** Folds one onData chunk into the draft: printable text accumulates, special keys count. */
export function applyToDraft(draft: InputDraft, data: string): InputDraft {
  if (!isPrintableChar(data)) {
    // Enter, arrows and bracketed paste frames contain controls; keep only plain text.
    return { ...draft, droppedSpecial: draft.droppedSpecial + 1 };
  }
  if (draft.text.length + data.length > MAX_DRAFT_CHARS) {
    return { ...draft, droppedSpecial: draft.droppedSpecial + 1 };
  }
  return { ...draft, text: draft.text + data };
}

export function draftIsEmpty(draft: InputDraft): boolean {
  return draft.text.length === 0 && draft.droppedSpecial === 0;
}
