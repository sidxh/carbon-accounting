# improve-ui audit — Inventory surface (`/inventory`)

Commit: after `02dc7be`. Read-only audit per `.agents/skills/improve-ui/SKILL.md`.

## Design language
- Audited surface: `web/src/app/inventory/page.tsx` rendered through `Shell wide` → `RequireAuth`, using `ui/bits.tsx` (`Stat`, `MixBar`, `PageTitle`, `TIER_PILL`, `TIER_BAR`), `ui/dialog.tsx`, `ui/toast.tsx`, tokens from `src/app/globals.css`.
- Design sources: `web/DESIGN.md`, `src/app/globals.css`.
- Documented decisions: `attention-strong` "is the amber dot in eyebrows and the estimated segment in charts; it is never text"; `attention` on `attention-bg` means the supplier has to act; two shadows only; only `transform`/`opacity` animate; numbers `tabular-nums`; headline statistics in `display`.
- Governing owners and consumers: `.card`, `.pill*`, `Stat`, `MixBar`, `.coverage`; `TIER_PILL`/`TIER_BAR` shared with Documents and Questions.
- Explicit exceptions: None documented.

## Findings
| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | The "Not computed" card signals attention with a `attention-strong` border, a use the contract reserves for the eyebrow dot and chart segments | `DESIGN.md › Colors`: "`attention-strong` is the amber dot in eyebrows and the estimated segment in charts"; "`attention` on `attention-bg` means one thing: the supplier has to act." Runtime: `inventory/page.tsx` skipped section: `className="card border-attention-strong/40 p-4 text-sm"`. | Drop the tinted border; mark the section with the existing `pill pill-attention` carrying the count next to the heading, which is how every other "needs you" state on the page is drawn. | `inventory/page.tsx` | High |
| 2 | Market-based headline uses `tone="muted"`, which paints a display statistic in the caption colour | `DESIGN.md › Colors`: "captions `muted`"; `Typography`: `display` is for headline statistics. Runtime: `<Stat … tone="muted" />` renders the number `text-muted`. | Use the default `ink` tone and keep the de-emphasis in the `sub` line ("Reported alongside; see method"). | `inventory/page.tsx` | Medium |
| 3 | Group subtotal rows and expanded rows use alpha-derived fills (`bg-sunken/40`, `bg-sunken/60`) rather than the `sunken` token | `DESIGN.md › Overview`: "Everything the UI paints with is a token … components name a role, never a hex value." Runtime: `inventory/page.tsx` rows. | Use `bg-sunken` directly. Counter-evidence: alpha variants of a token are still the token in Tailwind's model, and the contract does not forbid them explicitly, so confidence is low. | `inventory/page.tsx` | Low |

## Improve first
Finding 1. It cites an explicit prohibition, the correction reuses `pill-attention` which the same page already uses for estimated rows and filters, and it removes the only place in the app where `attention-strong` appears as a border.
