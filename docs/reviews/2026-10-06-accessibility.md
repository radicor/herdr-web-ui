# Accessibility audit — herdr-web-ui

> These findings are folded into the consolidated report at `docs/reviews/2026-10-06.md` (A1–A8
> there; the i18n finding became V3, the decorative-icon finding became A8, and the "intentional
> patterns" below became its `A-info` section). This file is kept for the fuller per-finding detail
> and the 13-item strengths list; the consolidated report is the authoritative one.

Date: 2026-10-06
Scope: `src/` client (`src/App.tsx`, `src/components/*.tsx`, `src/lib/*.ts`, `src/styles.css`, `index.html`, `patches/@xterm%2Fxterm@5.5.0.patch`)
Standard: WCAG 2.2 AA. Read-only analysis; no code was changed.
Environment note: `node_modules` is not installed, so no typecheck or test run was possible. All findings are from source reads plus programmatic contrast computation.

Findings are grouped by severity. Each carries the fields the audit calls for: Severity, Category, Location, Issue, Impact, Evidence, Reproduction, Recommended fix, Confidence.

---

## High

### A-1. The terminal surface — the app's primary interface — has no accessible semantics and xterm's screen-reader mode is never enabled

- **Severity:** High
- **Category:** Accessibility
- **Location:** `src/components/PaneTerminal.tsx:1548` (mount element) and `src/components/PaneTerminal.tsx:325-337` (`new Terminal({...})` constructor)
- **Issue:** The xterm host element is rendered as a bare `<div className={\`pane-terminal${paneId === null ? " is-idle" : ""}\`} ref={hostRef} />` with no `role`, no `aria-label`, and no `aria-roledescription`. The `Terminal` constructor sets `convertEol`, `cursorBlink`, `scrollback: 0`, `allowProposedApi: true`, `fontSize`, `fontFamily`, `theme` and `linkHandler` — but never sets `screenReaderMode`. xterm exposes that option (the bundled patch `patches/@xterm%2Fxterm@5.5.0.patch` branches on `this.optionsService.rawOptions.screenReaderMode` when deciding whether to retain textarea text on a Gboard backspace), and when it is off xterm does not keep the hidden helper textarea populated for assistive technology.

  Compounding this, the design deliberately removes the two fallbacks a screen-reader user would otherwise have: `scrollback: 0` (documented at `PaneTerminal.tsx:328-332` — "the attach stream lives in the alternate screen and herdr owns scrollback"), and the wheel handler that routes mouse reports, so there is no way to review what scrolled off the visible grid by any input device other than herdr's own commands.

- **Impact:** A screen-reader user cannot perceive the pane's contents at all. The product's central surface — a terminal running an agent — is unreachable, with no text alternative on this view. This fails SC 1.1.1 (non-text content) in the strict sense that the rendered grid is data presented visually with no equivalent, and it fails SC 4.1.2 (name, role, value) for the element itself: no name, no role beyond a generic `div`. It also blocks SC 2.1.1 (keyboard) for scrollback review, which is structurally impossible here by design. The chat lens (`ChatView.tsx:856`, `role="log" aria-live="polite"`) is a genuine, well-built alternative — but it is a *separate view* the user must know to switch to, and it does not carry raw terminal output (see `chat-terminal-fallback` at `ChatView.tsx:891`, which folds the raw output behind a `<details>` *inside* that other view).
- **Evidence:** `src/components/PaneTerminal.tsx:1548`; `src/components/PaneTerminal.tsx:325-337`; the patch file referencing `screenReaderMode`; `AGENTS.md` invariant "never give xterm scrollback (keep `scrollback: 0`)".
- **Reproduction:** Launch with any screen reader (VoiceOver on macOS, NVDA on Windows). Open a pane running an agent. Focus cannot land on the terminal with any meaningful announcement; nothing in the accessibility tree describes or exposes the grid contents. Switch to the chat view and the same pane's conversation reads correctly — confirming the gap is specific to the terminal lens.
- **Recommended fix:** Two independent steps, in this order.
  1. Give the host element a name and role: `role="region"` with `aria-roledescription="terminal"` and a dynamic `aria-label` (e.g. `t("Terminal: {title}", …)` — the component already has pane title state), so the surface is at least identified and announced.
  2. Evaluate `screenReaderMode: true` in the constructor. This is the real fix; it makes xterm keep its hidden textarea populated so AT can read live output. It must be validated end-to-end against the patched Gboard backspace guard in `patches/@xterm%2Fxterm@5.5.0.patch` (which behaves differently depending on this flag) and against IME composition — the codebase's composition guards (`isComposing` / keyCode 229 in `TabStrip.tsx:282`, `SettingsDialog.tsx:91`) suggest this class of bug is real here. Note the interaction with `AGENTS.md`: `scrollback: 0` must stay, so screen-reader review of scrolled-off content is a herdr-side concern, not something xterm can fix — worth confirming with the maintainers whether `terminal scrollback` RPCs could serve as the AT review path before claiming the fix is complete.
- **Confidence:** Confirmed (the missing attributes and the unset option are directly verifiable in the source; the patch proves the option exists and is read by code shipped in this repo).

---

## Medium

### A-2. Four dialogs declare `aria-modal="true"` but impose no Tab focus trap

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `src/components/SettingsDialog.tsx:219` (root), `src/components/CommandPalette.tsx` (root), `src/components/FileViewer.tsx` (root), `src/components/NewSessionDialog.tsx` (root)
- **Issue:** Each of these surfaces renders `role="dialog" aria-modal="true"` and then does nothing to contain Tab / Shift+Tab. `aria-modal="true"` tells the accessibility tree that everything outside the dialog is inert; browsers do not enforce that for focus. Pressing Tab walks out of the dialog into the (now supposedly inert) page behind it.

  The codebase already contains the correct pattern, so this is drift rather than a design decision: `ConfirmDialog.tsx` traps Tab — it cycles focus between Cancel and Confirm with `event.preventDefault()` while the dialog is open, and additionally holds focus on the surface while buttons are disabled. `RowMenu.tsx` traps Tab in its mobile sheet mode. `MachineDialog.tsx` uses a native `<dialog>` via `showModal()`, which traps by default. Only these four components were left out.

- **Impact:** Keyboard users (and the screen-reader users relying on Tab to survey a dialog) lose their place and can act on controls the dialog told AT were inert — an SC 2.4.3 (focus order) failure, and confusing rather than dangerous in practice since the background controls still work. The practical impact is highest for `CommandPalette` (Mod+Shift+K, opened constantly) and `SettingsDialog` (a long, scrollable dialog with many tab stops).
- **Evidence:** `ConfirmDialog.tsx` Tab handler; `RowMenu.tsx` `move`/Tab-trapped-in-sheet branch; `MachineDialog.tsx` `dialog.current?.showModal()`; contrast with `SettingsDialog.tsx:84-93` whose only `onKeyDown` is the IME-guarded Enter on a rename field, and `CommandPalette.tsx` whose only keyboard handling is Escape (window capture) plus arrow keys in the listbox.
- **Reproduction:** Open Settings (or the command palette, or a file from a chat message). Press Tab repeatedly. Focus leaves the dialog and lands on header buttons, the sidebar, or the terminal behind it.
- **Recommended fix:** Lift `ConfirmDialog`'s trap into a small `useFocusTrap`/`FocusTrap` wrapper and apply it to all four. The app already has the escape-key capture convention (window capture-phase, `preventDefault` + `stopPropagation`) so the wrapper only needs the Tab cycle. Keep `RowMenu`'s documented popover behaviour — Tab deliberately *closes* the desktop popover and *is trapped* in the sheet; that asymmetry is intentional and should not be "fixed".
- **Confidence:** Confirmed for the absence of the handlers; High Confidence on the SC 2.4.3 mapping.

### A-3. Focus is not returned to the opener when these dialogs close

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `src/components/SettingsDialog.tsx`, `src/components/CommandPalette.tsx`, `src/components/NewSessionDialog.tsx`, `src/components/FileViewer.tsx`
- **Issue:** None of these record the element that opened them or restore focus on unmount. `CommandPalette.tsx` focuses its input via `window.requestAnimationFrame(() => inputRef.current?.focus())` on open but never looks back; `FileViewer.tsx` contains no `focus()` call at all.

  Again the codebase has the pattern: `RowMenu.tsx` records its anchor and returns focus in a `useLayoutEffect` cleanup; `ConfirmDialog.tsx` records the opener in `useLayoutEffect` and refocuses it on unmount unless `done`; `UsageMeters.tsx:113` explicitly refocuses `stripRef` on Escape.

- **Impact:** After closing one of these, keyboard and screen-reader users land back on `<body>` and must re-orient from scratch — an SC 2.4.3 (focus order) issue and a genuine usability regression on a keyboard-heavy product. Most acute for `CommandPalette`, which is opened from anywhere via Mod+Shift+K and dismissed with Escape constantly.
- **Evidence:** Absence of `activeElement` capture / restore in the four files, contrasted with `RowMenu.tsx` cleanup, `ConfirmDialog.tsx` opener refocus, `UsageMeters.tsx:113`.
- **Reproduction:** Focus any control, open the command palette, press Escape. Focus is on `body`. Same for Settings and the file viewer.
- **Recommended fix:** Reuse the `ConfirmDialog`/`RowMenu` pattern — capture `document.activeElement` in a `useLayoutEffect` on mount, restore it in the cleanup unless the dialog itself moved focus intentionally. Pair with A-2 so the trap's last element hands back cleanly.
- **Confidence:** Confirmed.

### A-4. The tab strip implements `role="tablist"`/`role="tab"` but no `aria-controls` and no `role="tabpanel"` counterpart

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `src/components/TabStrip.tsx:258` (`role="tablist"`), `src/components/TabStrip.tsx:288-307` (each `role="tab"`)
- **Issue:** The roving-tabindex tab pattern is otherwise implemented carefully — `aria-selected={active}`, `tabIndex={active ? 0 : -1}`, ArrowLeft/Right/Home/End at `TabStrip.tsx:214-231`, F2 to rename and Delete to close, and careful focus hand-off when a tab closes (`TabStrip.tsx:90-98`, moving focus to the tab beside it or out to the workspace list via `focusWorkspaceListToggle()`). But no tab carries `aria-controls`, and nothing in the app carries `role="tabpanel"`.

- **Impact:** The tabs pattern is declared to AT but only half-implemented, so screen readers that follow the APG tablist pattern cannot relate a tab to the panel it governs — SC 4.1.2 (name, role, value). A tab *is* a button that switches panes here, so the functional behaviour is fine for keyboard users; this is an AT-relationship gap, not an interaction failure. Worth noting that the app shows one pane at a time, so a single `role="tabpanel"` region wrapping the pane view would satisfy the relationship.
- **Evidence:** `TabStrip.tsx:258`, `TabStrip.tsx:288-307`; no `tabpanel` anywhere in `src/`.
- **Reproduction:** With a screen reader, navigate the tab strip by arrow keys. The selected state is announced correctly (`aria-selected`), but there is no programmatic connection from a tab to the region showing its pane.
- **Recommended fix:** Add `aria-controls` to each tab pointing at the pane container's id, and give that container `role="tabpanel"` with an `aria-label` derived from the tab name (`t("{tab}", …)` — `tabLabel`/`customTabLabel` at `TabStrip.tsx:69` already exist for this). Alternatively, if a full tabpanel is judged too heavy for a one-pane-at-a-time layout, downgrade to a plain button group and drop the tablist roles — but the half-state should not stay.
- **Confidence:** Confirmed.

### A-5. Agent-authored markdown can emit `h1`–`h6` inside the transcript, breaking the page's heading hierarchy

- **Severity:** Medium
- **Category:** Accessibility
- **Location:** `src/components/Markdown.tsx` (heading branch, rendering real `h1`–`h6` from `block.level`), as rendered inside `src/components/ChatView.tsx:856` (`role="log"`)
- **Issue:** The app's own document outline is deliberate and correct: `Brand()` renders the single `<h1 className="brand">` in `App.tsx`, `MachineDialog.tsx` uses `<h2 id="machine-dialog-title">`, `SettingsDialog.tsx` uses `<h2 id="settings-title">` with `aria-labelledby`, `AccessGate.tsx` has `<h1 id="access-gate-title">`, `NeedsInput.tsx` and `DirectoryBrowser.tsx` use `<h2>` for their sections. But agent output passes through `Markdown.tsx`, which renders whatever heading levels the agent wrote — including `h1` and `h2` — straight into a `role="log"` region.

- **Impact:** Screen-reader users navigating by heading land on agent-written headings that are semantically presented as document structure but are really message content, and the page's real `h1`/`h2` outline is shadowed by arbitrary agent output. SC 1.3.1 (info and relationships). The impact is real in practice: agents frequently write `#` and `##` headings in their replies.
- **Evidence:** `Markdown.tsx` heading branch mapping `block.level` to `h1`–`h6`; the consuming `role="log"` at `ChatView.tsx:856`.
- **Reproduction:** Open any chat where the agent replied with a markdown heading. In a screen reader's heading list (`VO + U` / NVDA heading list) those agent headings appear as page structure alongside the app's own `h1`.
- **Recommended fix:** Remap agent heading levels into the transcript's own level — e.g. render them all as `h3` (below the app's `h1`/`h2`), or as `<p>` with a class carrying the visual weight, since the visual styling can stay exactly as it is. A `role="log"` child that is a heading is the specific thing to avoid.
- **Confidence:** Confirmed for the mechanism; High Confidence on the SC 1.3.1 mapping.

---

## Low

### A-6. The "reconnecting…" inline state has no ARIA role while its direct siblings do

- **Severity:** Low
- **Category:** Accessibility
- **Location:** `src/components/ChatView.tsx:896`
- **Issue:** Inside the same container, three lines apart: `chat-inline-error` carries `role="alert"` (`:894`), the loading state carries `role="status"` (`:897`), but the reconnecting line is a bare `<p className="chat-inline-state">{t("reconnecting…")}</p>`. `src/AGENTS.md` states "status surfaces use `role="status"`".

- **Impact:** A connection drop — the exact moment a user most needs to know the state — is not announced. SC 4.1.3 (status messages) for the non-error transitional case. `role="status"` is the right pick here (it is advisory, not an error), consistent with the loading line directly beside it.
- **Evidence:** `ChatView.tsx:894-897`.
- **Reproduction:** Disconnect the network while a chat is open. The visible "reconnecting…" line appears; a screen reader announces nothing.
- **Recommended fix:** `role="status"` on that `<p>`. One line.
- **Confidence:** Confirmed.

### A-7. `composer-hint`, `chat-empty` and `chat-endcap` have no live semantics

- **Severity:** Low
- **Category:** Accessibility
- **Location:** `src/components/Composer.tsx:1027` (`<div className="composer-hint">`), `src/components/ChatView.tsx:899` (`chat-empty`), `src/components/ChatView.tsx:884` and `:900` (`chat-endcap`)
- **Issue:** These advisory states appear and disappear with no role at all. The composer hint is the terminal-only-command notice ("`/{command}` opens a tree the chat cannot show…") that shows when the user types e.g. `/worktree`; the endcaps mark "beginning of conversation" and "terminal ended"; the empty state is the first-run landing.

- **Impact:** Minor — these are visible and mostly static, so they fail SC 4.1.3 only in the soft sense of not being announced when they appear. `composer-hint` is the most worth fixing of the three, because it appears reactively *while the user is typing* and its message (use the terminal, not the chat, for this command) is advice the user would otherwise miss entirely.
- **Evidence:** `Composer.tsx:1026-1027`; `ChatView.tsx:884`, `:899`, `:900`.
- **Reproduction:** Type `/worktree` (or another `terminalOnlyCommand`) into the composer. The hint renders below the box with no announcement. Reach the top of a long conversation: `chat-endcap` renders silently.
- **Recommended fix:** `role="status"` on `composer-hint`; `chat-empty` and `chat-endcap` can take `role="status"` too, or be left as-is if the team judges them static-visual. Consistency with the sibling states already carrying roles is the main argument.
- **Confidence:** Confirmed.

### A-8. An untranslated literal and an unlocalized date in the update controls

- **Severity:** Low
- **Category:** Accessibility (i18n)
- **Location:** `src/components/UpdateControls.tsx:50`
- **Issue:** ```{status?.checked_at && <p className="settings-hint">Last checked {new Date(status.checked_at).toLocaleString()}</p>}```

  Two bugs in one line, both violating the project's own conventions in `AGENTS.md`: "the English string is the key and must be a string literal" — the words "Last checked" are hardcoded, not `t("Last checked {when}", …)`; and `toLocaleString()` is called with no locale argument, while `src/lib/i18n.ts` documents `LOCALE_TAGS` as "The BCP 47 tag for `<html lang>` and Intl formatting" and `src/lib/settings.ts:330` already applies them to the document. Every other date in the app should be checked for the same omission.

  This escapes the test that normally catches it: `i18n.test.ts` scans `t("…")` keys, and this string was never wrapped in `t()` in the first place, so it is neither missing nor unused — it is invisible to the check.

- **Impact:** Korean, Japanese and Chinese users see untranslated English text and a browser-default-locale date inside an otherwise fully localized settings panel. Not a WCAG failure per se but a genuine localization defect on a shipped surface.
- **Evidence:** `UpdateControls.tsx:50`; `AGENTS.md` i18n rules; `src/lib/i18n.ts` `LOCALE_TAGS`; `src/lib/settings.ts:330`.
- **Reproduction:** Set the UI language to 한국어 and open Settings > Update. The "Last checked" line is in English with a locale-default date.
- **Recommended fix:** `t("Last checked {when}", { when: new Date(status.checked_at).toLocaleString(LOCALE_TAGS[language]) })`, then add the key to `i18n.ko.ts`, `i18n.ja.ts` and `i18n.zh.ts`. Grep for other bare `.toLocaleString(` / `.toLocaleDateString(` calls and other hardcoded English literals in `.tsx` (a quick pass over `settings-hint` and `hint` copy would catch the class).
- **Confidence:** Confirmed.

### A-9. A few decorative icons lack `aria-hidden`, most meaningfully inside a dialog heading

- **Severity:** Low
- **Category:** Accessibility
- **Location:** `src/components/MachineDialog.tsx:61` (`<Monitor size={18} />` inside `<h2 id="machine-dialog-title">`); also `src/App.tsx:735,745,748,774,778,798,815` and `src/components/SettingsDialog.tsx:280-433` (stepper `<Minus/>`/`<Plus/>`)
- **Issue:** The codebase has ~126 explicit `aria-hidden="true"` usages on decorative icons — it is the established convention — but ~27 capitalized icon elements render without one. Most of those are inside buttons that carry their own `aria-label` (all seven header buttons in `App.tsx` do, and all six Settings steppers do), so the button's accessible name is correct and the redundant icon is a minor noise issue rather than a mislabeled control.

  The one that genuinely matters is `MachineDialog.tsx:61`: `<h2 id="machine-dialog-title" className="modal-title"><Monitor size={18} /> {t(...)}</h2>`. That id is the `aria-labelledby` target for the whole dialog, so the heading's accessible name is what the dialog announces. An unlabeled svg in a heading can read as an empty image node in some AT configurations.

- **Impact:** Possible "unlabeled image" announcements from the PC-setup dialog's name, and minor redundant nodes elsewhere. SC 1.1.1, limited. Note the important non-finding here: `ChatView.tsx` chevrons *are* handled — the regex hits there are inside `<span aria-hidden="true">` wrappers (`:283`, `:303`, `:330`) or carry the attribute directly (`:354`, `:374`, `:440`), and `PromptCard.tsx`'s `<Check/>` sits inside an `aria-hidden` span. `AgentMark.tsx`'s eight marks are svgs with `role="img" aria-label`, which is correct.
- **Evidence:** Regex sweep of every `.tsx` for capitalized JSX elements without `aria-hidden` (27 hits), then per-site verification of context.
- **Reproduction:** With VoiceOver, open the "Add PC" dialog and listen to the dialog's announced name. On configurations that expose the svg, the heading name is interrupted by an unlabeled graphic.
- **Recommended fix:** Add `aria-hidden="true"` to `<Monitor>` in `MachineDialog.tsx:61`. Consider sweeping the button-icon sites for consistency with the repo's own 126-site convention — low value but zero risk. (Worth confirming which lucide-react version sets `aria-hidden` by default before doing the full sweep; `node_modules` is absent here so the default could not be verified.)
- **Confidence:** Confirmed for the omissions; the AT-announcement detail is Needs Verification.

---

## Informational (documented, intentional patterns — recorded so they are not "fixed" by mistake)

- **KeyBar `tabIndex={-1}`** — `src/components/KeyBar.tsx`. The component's own comment documents this: the bar is touch-only, and it uses `role="group"` rather than `toolbar` precisely because a `toolbar` promises arrow-key navigation it does not provide. Correct call; do not change.
- **RowMenu Tab behaviour** — Tab *closes* the desktop popover and *is trapped* in the mobile sheet, both documented in-component. Intentional asymmetry between pointer and keyboard flows.
- **The connection pill stays in the DOM when live** — `App.tsx` keeps the `role="status"` `.conn-live` pill mounted (drawn by nothing) so scripts and AT can wait on it. Intentional.
- **`--fs-2xs` (11px, 10px in compact density) pill text** — used for `.pill` labels at `src/styles.css:973`. Small but it passes contrast (see strengths below); recorded because compact density pushes it to 10px, which is below the 4.5:1-adjacent readability comfort zone but not a WCAG text-size requirement.
- **`QrCode.tsx` is dark-on-white in both themes** — documented in-component: cameras read inverted codes unreliably, so the no-color-literals rule does not apply. Correct exception.
- **`ChatView` uses `role="log"`** — the right APG role for a transcript (not `status`/`alert`, which would swamp the user with every line).

---

## Confirmed strengths

These are worth stating explicitly, because the audit's overall picture is a codebase with strong a11y fundamentals and a few specific holes — not a codebase that needs a top-to-bottom overhaul.

1. **Contrast passes AA numerically across every palette and theme.** I computed WCAG relative-luminance ratios programmatically for every text/status/accent token against every surface across all four palettes (amber, report, charcoal, catppuccin) in dark and light, including alpha-composited tint backgrounds for the badge variants. **All text tokens pass 4.5:1.** The lowest values found: amber light `--text-dim` on `--bg` at 5.29:1, light accent-on-accent-tint at 4.69:1, charcoal dark `--text-dim` at 5.75:1, charcoal blocked-on-tint at 5.44:1. The Catppuccin Latte block in `styles.css` documents deliberate darkening to clear AA (Mauve 17%, Red 18%, Blue 22%, Green 37%) — the constraint was known and designed for. Borders-as-text fail (1.23–1.31) but borders are not text. SC 1.4.3 and 1.4.11: satisfied.
2. **Reduced motion is handled structurally, and enforced by a test.** 13 `@media (prefers-reduced-motion: reduce)` blocks across the CSS, plus `src/motion.test.ts`, which walks every CSS file and fails the build if an `infinite` animation lacks `steps(` or `var(--ease-pulse)` (with `bridge-progress-slide` the one documented exemption, and a comment explaining why smooth endless animations burn frames while an agent works for minutes). SC 2.3.1: satisfied by construction. This is better practice than most shipping products.
3. **Focus visibility is global, not per-component.** `:focus-visible { outline: var(--ring); outline-offset: var(--ring-offset); }` at `src/styles.css:478-480` with `--ring: 2px solid var(--accent)`. SC 2.4.7: satisfied, and a focus ring that works on every interactive element including the terminal-adjacent controls. Roving tabindex is used where the APG wants it (`TabStrip`, and `KeyBar` documents its choice not to).
4. **Focus management is done well where it is done at all.** `ConfirmDialog` records its opener, traps Tab, suppresses Escape while pending, holds focus on the surface while buttons are disabled, and refocuses the opener on close. `RowMenu` returns focus to its anchor and suppresses Safari's mousedown focus loss with `keepFocus`. `TabStrip` moves focus to the neighbouring tab after a close, and falls back to `focusWorkspaceListToggle()` when the strip itself goes. `UsageMeters` refocuses its strip on Escape. This is the reference implementation the four dialogs in A-2/A-3 should be lifted from.
5. **`ConfirmDialog` is an `alertdialog`, used correctly.** `role="alertdialog" aria-modal="true" aria-labelledby aria-describedby`, with `role="alert"` for its error line and escalation to a named `ApiError` code. `MachineDialog` uses a real `<dialog>` + `showModal()` — the only component in the app to do so — with `onCancel` prevented.
6. **Combobox/listbox patterns are correct where used.** `AgentPicker` (button `role="combobox"` with `aria-haspopup`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; popup `role="listbox"` with `aria-selected` `role="option"`; Arrow/Home/End/Enter/Space/Tab-chooses/Escape; `onMouseDown preventDefault` keeping trigger focus). The same shape appears in `Composer`'s completion menus and `CommandPalette` (which additionally scopes its input with `aria-controls="palette-results"` and gives its empty state `role="status"`).
7. **`AccessGate` form a11y is exemplary.** `autoComplete="one-time-code"`, `inputMode="numeric"`, `pattern="[0-9]*"`, `maxLength={7}`, `autoFocus`, `aria-invalid` wired to `aria-describedby="access-gate-error"`, a real `label htmlFor`, and the long-lived token form tucked into a `<details>` with `type="password" autoComplete="current-password"`.
8. **`NeedsInput.tsx` is the model for status-with-count.** A visually-hidden `<p role="status">Panes waiting for input: {n}</p>` precedes a `<section aria-label>` + `<h2>` + list with `aria-current` on the active pane. Screen readers get the number first, sighted users get the list.
9. **Status is conveyed by word, not colour alone.** `Sidebar.tsx`'s `StatusBadge` renders `<span className="badge badge-<value>" data-status title>{t(STATUS_WORD[value])}</span>` — the status word is always present. Badge colour variants are reinforcing, not load-bearing (SC 1.4.1 satisfied).
10. **Live-region placement is deliberate.** `prompt-dock` is `aria-live="polite"` for the portaled `PromptCard`, which is `role="region" aria-label` with `aria-busy={pending}` and steps as `<ol>` with `aria-current="step"` and visually-hidden "(answered)" markers. `PaneTerminal`'s banners (`restore error`, warnings, waiting, draft, observe, queue error) are `role="status"`; the chat render-error fallback is `role="alert"`.
11. **Closed controls are actually removed from the a11y tree.** `VoiceRecordingPill` uses `aria-hidden={!open}` *and* conditional `tabIndex={open ? 0 : -1}` on both its buttons — both halves, which is the usual omission. `UsageMeters` refresh button is `aria-busy` rather than `disabled`, with an in-comment reason ("a disabled button drops focus, and Escape with it") — the kind of detail that shows a11y was considered at write time.
12. **`document.documentElement.lang` is driven by settings**, not left at the hardcoded `lang="en"` in `index.html` (`src/lib/settings.ts:330`, using `LOCALE_TAGS`), and `resolveLanguage` follows `navigator.languages`, honouring system-language preferences (commit 58accb7's fix landed this).
13. **The `.visually-hidden` clip pattern** is used consistently for off-screen-but-announced text, and `Droplet`'s card button composes a descriptive label (`${current.title}, ${detail}. ${t("Open pane")}`) rather than relying on its visible text — decorative svg `aria-hidden` + `focusable="false"` alongside.

---

## Summary by severity

| Severity | Count | Findings |
|---|---|---|
| High | 1 | A-1 terminal surface unreachable to AT |
| Medium | 4 | A-2 missing Tab traps, A-3 no focus restoration, A-4 incomplete tablist pattern, A-5 agent headings break outline |
| Low | 4 | A-6 reconnecting role, A-7 unroled advisory states, A-8 i18n drift, A-9 decorative icons |
| Informational | 6 | documented intentional patterns |

**Headline:** contrast, reduced motion, focus visibility, combobox/dialog semantics and live-region usage are all genuinely strong — better than typical for a product of this complexity. The one finding that matters is A-1: the terminal itself, the product's central surface, is invisible to screen readers, and the two usual fallbacks (scrollback, wheel review) are deliberately disabled by design. Everything else is a manageable set of dialog-focus and pattern-completeness fixes with working reference implementations already inside the codebase.

Note on the audit's own limits: `node_modules` was absent, so `screenReaderMode`'s exact behavioural effect under this repo's xterm patch was reasoned from the patch source rather than observed at runtime, and lucide-react's default `aria-hidden` behaviour could not be checked (see A-9).
