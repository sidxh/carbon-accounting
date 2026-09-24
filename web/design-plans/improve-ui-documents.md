# improve-ui audit — Documents surface (`/documents`)

Commit: after `02dc7be`. Read-only audit per `.agents/skills/improve-ui/SKILL.md`.

## Design language
- Audited surface: `web/src/app/documents/page.tsx` rendered through `Shell` → `RequireAuth`, using `ui/bits.tsx` (`PageTitle`, `EmptyState`, `CoverageStrip`), `ui/dialog.tsx`, `ui/toast.tsx`, tokens from `src/app/globals.css`.
- Design sources: `web/DESIGN.md` (contract), `src/app/globals.css` (implementation of tokens and primitives).
- Documented decisions: one accent per view (`signal`); `attention` only for "the supplier has to act"; `danger` for errors and destructive confirmations; empty states name one clear next action; structural skeletons for loading; pills always carry their word.
- Governing owners and consumers: `.card`, `.btn*`, `.pill*`, `.coverage` (globals.css) consumed by the page; `EmptyState` (bits.tsx) consumed by Documents and Inventory and Questionnaire.
- Explicit exceptions: None documented.

## Findings
| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | The empty state on a fresh account has no action inside it | `DESIGN.md › Components`: "Empty states name one clear next action." Runtime: `documents/page.tsx` renders `<EmptyState icon={ImagePlus} title=… body=… />` with no `action` prop while the only action sits in a separate drop-zone card above it. | Pass `action={<button className="btn" onClick={() => pick.current?.click()}>{t("pick")}</button>}` to the `EmptyState`. | `documents/page.tsx` | High |
| 2 | "Reading…" pill uses `pill-muted`, a variant the contract does not define | `DESIGN.md › components` lists `pill-primary`, `pill-attention`, `pill-secondary`, `pill-danger`. Runtime: `DocCard` applies `pill-muted` for `extracting`/`uploaded`. | Either add `pill-muted` (`sunken`/`muted`) to `DESIGN.md` as the in-progress variant, or render the in-progress state as text with the spinner rather than a pill. Two corrections are possible, so this is recorded for a decision, not planned. | `documents/page.tsx`, `DESIGN.md` | Medium |

## Improve first
Finding 1. It is a one-line change against an explicit contract sentence, it affects every first-run user, and the fix reuses an existing prop on an existing shared owner.
