---
version: alpha
name: NetZero
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

NetZero turns photographed utility bills into a cited Scope 1 and 2 inventory and a filled buyer questionnaire, for small manufacturers on a phone. The surface reads as paper rather than screen: an off-white page, cards that lift by going whiter, near-black ink, a serif display face over a humanist sans. One colour carries meaning (teal), one colour asks for attention (amber), one colour reports trouble (terracotta). Everything the UI paints with is a token in `src/app/globals.css`; components name a role, never a hex value.

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

Numbers that change while the user watches (headline statistics after a recompute or correction) use NumberFlow; static numbers do not animate.

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

Every looping animation lives on the landing page; nothing in the product UI loops. The hero (`components/landing/earth-hero.tsx`) is one pinned, scroll-driven scene around a lit 3D earth (`hero-globe.tsx`, WebGL via three.js, loaded on demand): pale marble ocean, leafy continents from Natural Earth, a smoking factory in South America, an offshore rig and two container ships across the Pacific (the earth spins faster while that open ocean faces the viewer), a truck driving over from the far side, a plane higher up. First view: a centred headline and one button, the earth rising from the bottom edge just under them (measured live, so they never overlap), and CO₂ / N₂O / CH₄ / Scope 1 / Scope 2 tags round its rim. Scrolling glides the earth aside and shrinks it to a whole planet beside the story, while an orbit ring draws round it and its own gas tags take over; scroll speed spins the earth up. The movement follows the user's own scroll, so it stays under reduced motion; the self-running spin, puffs and bobbing stop. "How it works" follows (`steps-flow.tsx`): its heading sits near the top of the screen and inks in as the section scrolls into view, a `signal-ink`-to-`ink` gradient sweeping across pale text (the one animated `background-position`, on the landing page only); the section pins while the page scrolls, and the scroll moves through five steps on the left, a wheel with the active one bright with a `signal` dot and the rest fading above and below. The card on the right plays each step's animation by itself when that step comes up, then holds its last frame: landscape bills dropped one at a time onto an overlapping pile inside a translucent folder as its count climbs, a bill scanned with its fields filled and a missing month asked about, the inventory built (monthly bars growing, the total counting up beside a Scope 1/2 ring, one month traced to its bill and factor), a reduction plan (the sun rising over a factory roof as solar panels are laid one by one and sunlight sweeps across them, then the ranked levers, rooftop solar, LED retrofit and compressed-air leaks, as bars growing in, with solar's payback), and the customer's sheet filled cell by cell before a "ready to send" stamp (all in `flow-scenes.tsx`). On first arrival a big "NetZero" switch is pressed on by a cursor before the steps appear; arriving from below skips it. Scenes slide up when scrolling down and back when scrolling up; clicking a step scrolls to it. Under reduced motion the switch is skipped and each step shows finished. The features section follows (`features.tsx`): it pins while a C60 buckyball (`fullerene.tsx`, three.js, atoms and bonds in the site's greens) turns, then bursts apart with the scroll, bonds snapping first and atoms flying out and fading; out of the burst comes "We are your …" in Garamond, the role rolling vertically like a slot reel through the jobs it stands in for (carbon accounting lead, sustainability analyst, ESG reporting analyst, GHG inventory analyst, emissions data analyst, decarbonisation advisor: real titles kept within two characters of each other), on one line at the same size as the lead; the reel is as wide as the longest role, so the line stays centred, the current one in `signal-ink` and its neighbours faint above and below. Right under it, in the same pinned view, six feature cards in a three-column grid (24px radius, `raised` to `signal-bg`; each one icon, a title and a single line) fade up one after another just after the headline; on phones, where they cannot share a screen with it, they follow below instead. On narrow (portrait) screens the camera backs off so the whole cage fits the width (about three quarters of it at full size) instead of being cropped at the sides, the canvas renders at a lower pixel ratio, and the section is pulled up less, so the steps' card no longer sits over it. Under reduced motion the buckyball fades instead of bursting and the role does not roll. The landing bar (`site-nav.tsx`) is a floating cream pill (`raised`, a faint `signal` border, `--shadow-float`): wordmark, the page's sections (a `signal-bg` pill slides behind the one in view), the language and the way in, with a `signal` hairline along its foot filling as the page is read. It slides up out of the way while scrolling down past the first screen and returns on the first scroll up. The page ends in an illustrated footer (`landscape-footer.tsx`, drawing the shared `landscape.tsx`): misty ridges fading out of `paper`, a lake, pines, three wind turbines whose blades turn slowly, a farmhouse with a solar roof and a big tree, settling into deep green ground that carries the links (the page's sections, the standards the numbers are cited from, the language) in `signal-on`. Its greens are illustration colours, not tokens. The sign-in page shares this look: the landing pill bar (linking back to the landing sections, with a Home button), and behind it a still picture of factory smoke turning into landscape (`smokescape.tsx`, after the tubik illustration, mirrored): two banded chimneys on a long, low factory, the landscape rising straight out of their tops (its foot flicked with white crescents), filling the top of the page and running right behind the sign-in column, a wavy stippled lavender-grey ribbon of smoke along its foot that thins out to a point behind the form card. Inside, the footer's landscape (misty ridges, a lake, pines, slowly turning turbines, the farmhouse and the big tree, over deep green ground, the dark hills dropping away past the turbines so only pale ridges sit behind the text; `Farmhouse`, `Tree`, `Turbine` and `pines` are shared from `landscape.tsx`); a fine grain over the landscape and factory for a printed feel; it fills the first screen across the full width. On the right, the tag pill, a big Garamond "Sign in", a short line and the form on the card gradient, its fields underlined and dashed in `signal`. Phones show the picture as a strip above the form. The flow animates only `transform` and `opacity` (its counters use NumberFlow); the globe draws to a canvas and its tags use NumberFlow. Both pause while off-screen or while the tab is hidden, are exposed to assistive tech as a single `role="img"` with a written description, and render still under reduced motion. The globe is a picture, not UI state: its land, ocean, truck and plane colours are illustration colours, not tokens.

Setup (`app/setup/page.tsx`) borrows the sign-in look for the product side: four short steps (company, reporting year, sites, optional revenue), each a big Garamond question on the card gradient with underlined fields and pill buttons, under a rail of four bars that fill as you go (reached steps can be clicked; returning suppliers can save from any step). Year presets are chips; sites are rounded cards with a dashed "Add a site" card. Steps slide and fade (transform and opacity, 0.22s); under reduced motion they only fade. Behind the page, two very light blurred green blobs (`components/blob-backdrop.tsx`), one high on the right and one low on the left, fixed and still.

Home (`app/home/page.tsx`) follows suit over the same blob backdrop (`BlobBackdrop`, shared with setup): the company name in the tag pill and a big Garamond line. With no requests yet, the page itself asks for the first one (`home/request-flow.tsx`): one form (who asked; which year as chips, with "New year…" revealing the dates; then, under a dashed "Optional" divider, due date, share and their Excel) in the setup card style, with the three trust points as small cards under it. Once there are requests, the page widens (`Shell wide`) into two columns: customers on the left, most urgent first, and their reporting years on the right, held in view (sticky) while the customers scroll; phones stack them. The heading counts customers ("3 customers") with "+ New request" on the same row. It opens the same one-form request in a Base UI dialog over the page, blurred behind it (`bg-ink/25 backdrop-blur-md`), on the card gradient with a round close button. Creating a request keeps you on Home: the dialog closes and the new customer card joins the list; the request opens only when you press its Start. Each customer card stays short: initials in a `signal-bg` square, the name in bold Garamond, one urgency pill (Overdue `pill-danger` red, Due soon `pill-attention` yellow, In progress `pill-secondary` blue, Not started `pill-muted` grey, Done `pill-primary` green; cards sort in that order, nearest due date first within a group), the year and due date, the four-bar rail, and one round Start / Continue / Open button. Year cards are compact for the side column, stacked top to bottom: the year in bold Garamond, its dates in `ink`, then bills and which customers use it; coverage strips and the Scope 1 and 2 totals (two Garamond numbers side by side) appear only once there are bills, so an empty year carries no "No bills yet" filler. Section labels are mono `↳` lines on soft `raised` pills. Underlined text fields (sign-in, setup, the request form) start their text 12px in from the underline's start (`px-3`), and their labels and hints are inset to match.

The Bills step (`app/r/[rid]/documents/page.tsx`) uses the wide shell and two columns, so nothing important sits below a long list. On the left, held in view (sticky): the "Add bills" card (the drop zone; once files are chosen it shrinks to one row with "Add more", and the chosen files scroll inside the card above an always-visible Upload button); that column is only for adding. "Continue to questions" belongs to the result, not the input: it sits with the page title, top right (disabled with a hint until a bill is read), A closing card after the groups says how many monthly bills are still missing ("we'll ask about them on the next step") or that every month is covered. It carries its own Continue only once the header's has scrolled out of view (IntersectionObserver), so only one Continue is ever on screen. On the right, "What we read": one dropdown card per energy type (Electricity, LPG, Diesel, Refrigerant, then unread or failed bills), whose header carries the name in bold Garamond, a Full year (green) or "n months missing" (yellow) pill, the bill count and total, and, in plain words, which months are missing ("Missing for: Feb, Mar, Apr"), not a strip of empty boxes. Opening a group lists its bills as compact rows (thumbnail, name, what was read with confidence, status pill, Retry and Remove); groups that need action start open, the rest closed, and closed rows stay in the page (`hidden`) so every bill remains findable. Phones stack the two columns.

The Inventory step (`app/r/[rid]/inventory/page.tsx`) opens as a compact dashboard with one colour language: Scope 1 is `ink`, Scope 2 is `signal`, and estimated is yellow (`attention-strong`) diagonal hatching laid over whatever the figure already is. That way an estimated month keeps its Scope 1/2 split, and green never means anything but Scope 2.

To try the flow without real paperwork, both upload steps offer a sample as a secondary pill under their drop zone, with a one-line hint. The Bills step has 31 Japanese bills as a zip (`public/sample-bills-japan.zip`). The Questionnaire step has a blank Japanese buyer's survey for the same year (`public/sample-questionnaire-japan.xlsx`), always on offer. The step is two columns. On the left are the customer's Excel card and, under it, the options for buyers with no spreadsheet. On the right, the result tile (the progress ring with its three counts, and Download filled questionnaire) heads Sections 1…n; before any fill, it shows the empty card and the colour legend instead. The no-spreadsheet options (answer packs for CDP, Higg FEM and EcoVadis, and EFRAG's VSME template) form one compact list card: a monogram badge, a short name, one muted line, and an Open or Download pill on the right. The whole row is clickable for packs, and the VSME result appears inside its own row.

- **Ring card (left):** a small Scope 1 + 2 ring. Hovering or focusing a slice, or its key row, thickens that slice, dims the other and puts its exact tonnes and share in the middle; otherwise the middle shows the total. Under it is an aligned key (dot, name with a one-line note, tonnes, share). Market-based Scope 2 follows as a footnote (reported alongside, not a slice), then data quality as a bar: read from bills solid neutral, estimated hatched.
- **Month card (right):** stacked bars at a modest height, with a 0 / half / top scale, dashed gridlines and a small key in the header. Hovering or focusing a month shows a tooltip with its Scope 1, Scope 2 and total, and whether it was estimated. The year is marked under the first month and each January.
- **"Where you could cut emissions":** a full-width plain invitation ("Tap to explore" ↗). It opens the reduction plan (`components/reduce-planner.tsx`) in a Base UI dialog over a blurred page (`bg-ink/25 backdrop-blur-md`), with the plan's cards on `card-sunken`. `/r/[rid]/reduce` still renders the planner as a page.
- **Below:** the method card, then the lines table. Rows show periods with a two-digit year ("Feb 01 – Feb 28 ’26"). Clicking anywhere on a row opens its calculation, and the chevron stays as the keyboard way in. An open row has steps 1 (From your bill, built around "Show me where") and 2 (Emission factor) on the left. Assumptions sit on the right with step 3 (Calculation, stacked to fit the narrow column) under them. When the assumptions would run longer than the steps beside them (measured with a ResizeObserver), the calculation moves above them so the result stays in view. On phones the calculation follows the steps and the assumptions come last. The header button reads "Recalculate" once a calculation exists.

The problem page (`app/problem/`, linked as "The problem" in the landing bar and footer) is laid out like a newspaper page around a picture, with no motion and no product, and written for someone outside the industry (no abbreviation goes unexplained). The picture (`reaching-hands.tsx`, illustration colours, drawn straight onto the paper with no panel): a human hand slanting in from the top, near the wordmark end of the bar, and a hand of leaves rising in from the lower left with its wrist in frame, their index fingertips almost touching. Each hand is a palm, a thumb and four separate fingers; the human hand is softly lit with creases and a nail, the leafy one packed with leaves and roughened at the edge, and both carry a printed grain. On wide screens it floats left, pulled out to the page edge, and the text wraps its outline through CSS `shape-outside` (the polygon `HANDS_SHAPE`, exported beside the hands' transforms so the two move together): beside the arm the outline runs almost straight, just clear of its widest point, so the Garamond claim (its second sentence in `signal-ink`) steps in only a few pixels a line and reads naturally; round the fingertips it curves in. A very light green blob (a blurred radial wash of `signal`, the one glow on this page) sits behind the claim. The four numbered sections (who it hits, why it is hard, what is at stake, who is asking) clear the picture and all start from the same left edge. The sections are set like newspaper subheads (a `signal-ink` numeral and a Garamond title, a small mono subtitle, then text) because a full-width rule cannot follow the outline. One or two key phrases per section are highlighted with `<mark>` (`signal-bg` wash, `signal-ink` text, cloned across line breaks); facts carry numbered superscript references to a numbered source list. On phones the picture sits above the words. English only for now, with a one-line note in other languages. The bar marks the page with its sliding pill (`page="problem"`); below lg the bar drops its language switcher to fit four links (the footer keeps it).

Every animation respects `prefers-reduced-motion`; `globals.css` collapses all durations when it is set.

## Do's and Don'ts

- Do keep one accent colour per view. Amber is a request for action, not a second accent.
- Do pair every colour-coded state with its word.
- Don't use gradients, glows or backdrop blur. One exception: on the landing page (`components/landing/leaves.tsx`), long, faint leaves run down both edges behind everything, and a `signal-bg` wash fades in and out behind "How it works"; the steps flow's card is `raised` fading to `signal-bg` across its lower corner, with a 28px radius, larger than the `lg` token, on the landing page only. The landing buckyball's burst is the one glow: a brief yellowish-white flash (emissive atoms, a light in the cage and a bloom behind it) as the cage breaks, nothing at rest.
- Don't hand-roll focus traps, menus or OTP inputs; the primitives are chosen.
- Don't animate layout properties, and don't animate anything the user triggers from the keyboard.
- Don't change `letter-spacing` outside `eyebrow` and `display`.
