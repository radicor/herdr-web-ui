import { describe, expect, it } from "bun:test";
import { applyToDraft, draftIsEmpty, DRAFT_TTL_MS, EMPTY_DRAFT, restoreDraft } from "./draft.ts";

describe("applyToDraft", () => {
  it("appends a printable character to the draft", () => {
    expect(applyToDraft(EMPTY_DRAFT, "a")).toEqual({ text: "a", droppedSpecial: 0 });
  });

  it("keeps the order of consecutive typed characters", () => {
    const draft = applyToDraft(applyToDraft(EMPTY_DRAFT, "l"), "s");
    expect(draft.text).toBe("ls");
  });

  it("counts a special key instead of drafting it", () => {
    const draft = applyToDraft(applyToDraft(EMPTY_DRAFT, "x"), "\r");
    expect(draft).toEqual({ text: "x", droppedSpecial: 1 });
  });

  it("counts escape sequences, arrows and control codes as special keys", () => {
    for (const special of ["\u001b[A", "\u0003", "\u001b", "\t"]) {
      expect(applyToDraft(EMPTY_DRAFT, special).droppedSpecial).toBe(1);
    }
  });

  it("caps the draft instead of growing without bound", () => {
    let draft = EMPTY_DRAFT;
    for (let i = 0; i < 1100; i += 1) draft = applyToDraft(draft, "x");
    expect(draft.text.length).toBe(1024);
    expect(draft.droppedSpecial).toBe(1100 - 1024);
  });

  it("treats DEL and non-printable single characters as special", () => {
    expect(applyToDraft(EMPTY_DRAFT, "\u007f").droppedSpecial).toBe(1);
  });
});

describe("draftIsEmpty", () => {
  it("is true for the empty draft and false once anything is held", () => {
    expect(draftIsEmpty(EMPTY_DRAFT)).toBe(true);
    expect(draftIsEmpty({ text: "", droppedSpecial: 1 })).toBe(false);
    expect(draftIsEmpty({ text: "a", droppedSpecial: 0 })).toBe(false);
  });
});

it("holds multi-codepoint IME commits without splitting a surrogate at the limit", () => {
  for (const text of ["한글", "😀", "e\u0301", "abc"]) expect(applyToDraft(EMPTY_DRAFT, text).text).toBe(text);
  expect(applyToDraft({ text: "a".repeat(1023), droppedSpecial: 0 }, "😀").text).toHaveLength(1023);
  expect(applyToDraft(EMPTY_DRAFT, "\x1b[200~text\x1b[201~").text).toBe("");
});

describe("restoreDraft", () => {
  const now = 1_800_000_000_000;
  const record = (at: number) => JSON.stringify({ text: "hunter2", droppedSpecial: 0, at });

  it("restores a draft written inside the TTL", () => {
    expect(restoreDraft(record(now - 1000), now)).toEqual({ text: "hunter2", droppedSpecial: 0 });
  });

  it("forgets a draft past the TTL", () => {
    expect(restoreDraft(record(now - DRAFT_TTL_MS - 1), now)).toEqual(EMPTY_DRAFT);
  });

  it("forgets an undated record: an unknown age is not a recent one", () => {
    expect(restoreDraft(JSON.stringify({ text: "hunter2", droppedSpecial: 0 }), now)).toEqual(EMPTY_DRAFT);
  });

  it("holds nothing for a missing, malformed or hand-edited record", () => {
    expect(restoreDraft(null, now)).toEqual(EMPTY_DRAFT);
    expect(restoreDraft("not json", now)).toEqual(EMPTY_DRAFT);
    expect(restoreDraft(JSON.stringify({ text: 7, droppedSpecial: 0, at: now }), now)).toEqual(EMPTY_DRAFT);
    expect(restoreDraft(JSON.stringify({ text: "a", droppedSpecial: 1.5, at: now }), now)).toEqual(EMPTY_DRAFT);
    expect(restoreDraft(JSON.stringify({ text: "a", droppedSpecial: 0, at: "soon" }), now)).toEqual(EMPTY_DRAFT);
  });

  it("keeps the special keys it counted, and forgets them with the text", () => {
    expect(restoreDraft(JSON.stringify({ text: "ls", droppedSpecial: 3, at: now - DRAFT_TTL_MS - 1 }), now)).toEqual(EMPTY_DRAFT);
    expect(restoreDraft(JSON.stringify({ text: "ls", droppedSpecial: 3, at: now }), now)).toEqual({ text: "ls", droppedSpecial: 3 });
  });
});
