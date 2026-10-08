---
version: alpha
name: Supplier Carbon
description: Design contract for the supplier-facing web app. Tokens are normative; globals.css is their only implementation.
colors:
  primary: "#0e7c72"
  paper: "#f7f6f3"
  raised: "#fffefc"
  sunken: "#efeeea"
  ink: "#171716"
  ink-soft: "#3d3d3a"
  muted: "#6f6e69"
  faint: "#a3a29c"
  line: "rgb(23 23 22 / 12%)"
  line-strong: "rgb(23 23 22 / 22%)"
  signal: "#0e7c72"
  signal-ink: "#0a5d55"
  signal-bg: "#e6f3f0"
  signal-on: "#ffffff"
  attention: "#8a5a00"
  attention-bg: "#fff3d6"
  attention-strong: "#f2b705"
  danger: "#b3452f"
  danger-bg: "#fbe9e4"
  tier2: "#4b5f8a"
  tier2-bg: "#e8edf7"
typography:
  display:
    fontFamily: EB Garamond
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: -0.015em
  sans:
    fontFamily: Figtree
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: ui-monospace
    fontSize: 12px
  eyebrow:
    fontFamily: Figtree
    fontSize: 11px
    fontWeight: 600
    letterSpacing: 0.14em
rounded:
  sm: 8px
  base: 12px
  lg: 18px
  full: 999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  page:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.sans}"
  button:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-on}"
    typography: "{typography.sans}"
    height: 44px
    padding: 10px 20px
    rounded: "{rounded.full}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
  button-danger:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
  card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: 16px
  well:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: 12px
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.sans}"
    height: 44px
    padding: 10px 14px
    rounded: "{rounded.sm}"
  pill-primary:
    backgroundColor: "{colors.signal-bg}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.full}"
  pill-attention:
    backgroundColor: "{colors.attention-bg}"
    textColor: "{colors.attention}"
    rounded: "{rounded.full}"
  pill-secondary:
    backgroundColor: "{colors.tier2-bg}"
    textColor: "{colors.tier2}"
    rounded: "{rounded.full}"
  pill-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
  eyebrow:
    textColor: "{colors.muted}"
    typography: "{typography.eyebrow}"
  caption:
    textColor: "{colors.faint}"
    typography: "{typography.mono}"
  ink-soft-text:
    textColor: "{colors.ink-soft}"
  line:
    backgroundColor: "{colors.line}"
  line-strong:
    backgroundColor: "{colors.line-strong}"
  attention-marker:
    backgroundColor: "{colors.attention-strong}"
---

## Overview

Supplier Carbon turns photographed utility bills into a cited Scope 1 and 2 inventory and a filled buyer questionnaire, for small manufacturers on a phone. The surface reads as paper rather than screen: an off-white page, cards that lift by going whiter, near-black ink, a serif display face over a humanist sans. One colour carries meaning (teal), one colour asks for attention (amber), one colour reports trouble (terracotta). Everything the UI paints with is a token in `src/app/globals.css`; components name a role, never a hex value.

## Colors

`paper` is the page; `raised` is every card and input; `sunken` is a well inside a card (chat bubbles, staged file rows, calculation blocks). Text is `ink`, secondary text `ink-soft`, captions `muted`, and `faint` only for axis labels and disabled text.

`signal` is the single accent per view. It marks the primary action, the current step, links, and data that came straight from a bill (tier `primary`). `signal-bg` behind `signal-ink` is the resting fill for "done" pills and the focus ring.

`attention` on `attention-bg` means one thing: the supplier has to act. Missing months, flagged questionnaire cells, estimated data, the open item being asked about. `attention-strong` is the amber dot in eyebrows and the estimated segment in charts; it is never text.

`danger` on `danger-bg` is for errors and destructive confirmations only. `tier2` on `tier2-bg` marks data the supplier corrected or that was unit-converted (tier `secondary`) and answers the supplier typed.

Tier colours are always paired with the tier word in a pill; colour is never the only signal.

## Typography

`display` (EB Garamond) is for page titles, section titles inside cards, headline statistics and the landing hero; italics are allowed in the hero only. `sans` (Figtree) is everything else. `mono` is for identifiers, factor ids, phone numbers and arithmetic. `eyebrow` is the only place `letter-spacing` is positive; display headings are the only place it is negative. Do not change tracking anywhere else.

Headings use `text-balance`; ledes and body paragraphs use `text-pretty`. Every number in a table, stat or calculation uses `tabular-nums`. Japanese falls back to the system serif and sans through the font stacks declared in `globals.css`; do not add a CJK web font.

## Layout

The grid is 4px; every margin, padding and gap is a multiple of it. Pages are a single column, `max-w-3xl` for forms and chat and `max-w-5xl` for the inventory and the landing. The stepper is sticky under the header on the app pages. Fixed bottom bars and toasts add `env(safe-area-inset-bottom)`.

Only six z-index levels exist; the DESIGN.md schema cannot hold them, so they live in `globals.css` and are used through the utilities named here. Arbitrary `z-[n]` is not used.

| Utility | Value | Used by |
| --- | --- | --- |
| `z-sticky` | 10 | stepper bar |
| `z-header` | 20 | landing floating nav |
| `z-bar` | 30 | fixed bottom action bar |
| `z-menu` | 40 | account menu |
| `z-dialog` | 50 | dialogs and their backdrop |
| `z-toast` | 60 | toasts |

## Elevation & Depth

Two shadows, declared as `--shadow-raised` and `--shadow-float` in `globals.css` (the schema has no shadow tokens). `raised` is a hairline lift for resting cards: `0 1px 2px rgb(23 23 22 / 4%), 0 1px 0 rgb(23 23 22 / 4%)`. `float` is for surfaces above the page (dialogs, menus, toasts, the landing nav, the lineage mock): `0 12px 32px rgb(23 23 22 / 10%), 0 2px 6px rgb(23 23 22 / 6%)`. Nothing else casts a shadow, and nothing blurs the layer beneath it.

Focus is a 2px `signal` outline with 2px offset on every interactive element, never a box-shadow.

## Shapes

Cards and dialogs use `rounded.base`; inputs, thumbnails and menu items use `rounded.sm`; the landing nav and large panels use `rounded.lg`; buttons and pills are `rounded.full`.

## Components

Buttons are at least 44px tall, press to `scale(0.97)` over `press` with `ease-out`, and are disabled with muted colours, never opacity. Primary is `signal` on `signal-on`; secondary is `raised` with a `line-strong` border; ghost is transparent; danger is `raised` with `danger` text. Icon-only buttons carry an `aria-label`.

Dialogs, menus and any surface with keyboard or focus behaviour come from `@base-ui/react`. Destructive or irreversible actions (remove a bill, start over, reset questions) use `AlertDialog`; reversible edits use `Dialog`. Menus scale in from their trigger over `fast`; dialogs stay centred. Toasts are Sonner, styled with these tokens, announced politely, and never the only place an error appears: the error also renders next to the action that caused it.

One-time codes use `input-otp`. Numbers that change while the user watches (headline statistics after a recompute or correction) use NumberFlow; static numbers do not animate.

Coverage strips are twelve cells per fiscal year: `signal` for months read from a bill, `tier2` for corrected months, amber hatching for estimated months, a dashed `line-strong` outline for missing months, and each cell carries a `title` naming the month and its state.

Empty states name one next action. Loading states are structural skeletons that pause their shimmer when off-screen.

## Motion

Animation exists for feedback, spatial consistency, state indication or to prevent a jarring change. It does not exist to decorate. Anything a supplier does more than a few times a day (typing, sending a chat message, opening a row, keyboard actions) either does not animate or animates in under `fast` with opacity only.

The schema has no motion tokens; these are declared in `globals.css` and are the only easings and durations the app uses.

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | anything entering or giving feedback |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | something already on screen moving |
| `--dur-press` | 160ms | button press |
| `--dur-fast` | 150ms | menus, tooltips, row expansion |
| `--dur-enter` | 220ms | dialogs, toasts, cards entering |
| `--dur-reveal` | 600ms | landing-page scroll reveals only |

Only `transform` and `opacity` animate. `ease-in` is never used, with one exception: in the landing steps flow, bills dropping into the folder fall under gravity (an ease-in fall and a small bounce), because a fall that decelerates reads as floating. Nothing enters from `scale(0)`; entrances start at `scale(0.95)` or later with opacity. `reveal` is permitted only on the landing page, which is explanatory marketing rather than product UI.

The landing page has the only two looping animations, and nothing in the product UI loops. The hero (`components/landing/earth-hero.tsx`) is one pinned, scroll-driven scene around a lit 3D earth (`hero-globe.tsx`, WebGL via three.js, loaded on demand): pale marble ocean, leafy continents from Natural Earth, a smoking factory in South America, a truck driving over from the far side, a plane higher up. First view: a centred headline and one button, the earth rising from the bottom edge just under them (measured live, so they never overlap), and CO₂ / N₂O / CH₄ / Scope 1 / Scope 2 tags round its rim. Scrolling glides the earth aside and shrinks it to a whole planet beside the story, while an orbit ring draws round it and its own gas tags take over; scroll speed spins the earth up. The movement follows the user's own scroll, so it stays under reduced motion; the self-running spin, puffs and bobbing stop. "How it works" follows (`steps-flow.tsx`): the section pins while the page scrolls, and the scroll moves through four steps on the left, a wheel with the active one bright with a `signal` dot and the rest fading above and below. The card on the right plays each step's animation by itself when that step comes up, then holds its last frame: landscape bills dropped one at a time onto an overlapping pile inside a translucent folder as its count climbs, a bill scanned with its fields filled and a missing month asked about, the inventory built (monthly bars growing, the total counting up beside a Scope 1/2 ring, one month traced to its bill and factor), and the customer's sheet filled cell by cell before a "ready to send" stamp (all in `flow-scenes.tsx`). On first arrival a big "Supplier Carbon" switch is pressed on by a cursor before the steps appear; arriving from below skips it. Scenes slide up when scrolling down and back when scrolling up; clicking a step scrolls to it. Under reduced motion the switch is skipped and each step shows finished. The flow animates only `transform` and `opacity` (its counters use NumberFlow); the globe draws to a canvas and its tags use NumberFlow. Both pause while off-screen or while the tab is hidden, are exposed to assistive tech as a single `role="img"` with a written description, and render still under reduced motion. The globe is a picture, not UI state: its land, ocean, truck and plane colours are illustration colours, not tokens.

Every animation respects `prefers-reduced-motion`; `globals.css` collapses all durations when it is set.

## Do's and Don'ts

- Do keep one accent colour per view. Amber is a request for action, not a second accent.
- Do pair every colour-coded state with its word.
- Don't use gradients, glows or backdrop blur. One exception: on the landing page (`components/landing/leaves.tsx`), long, faint leaves run down both edges behind everything, and a `signal-bg` wash fades in and out behind "How it works"; the steps flow's card is `raised` fading to `signal-bg` across its lower corner, with a 28px radius, larger than the `lg` token, on the landing page only.
- Don't hand-roll focus traps, menus or OTP inputs; the primitives are chosen.
- Don't animate layout properties, and don't animate anything the user triggers from the keyboard.
- Don't change `letter-spacing` outside `eyebrow` and `display`.
