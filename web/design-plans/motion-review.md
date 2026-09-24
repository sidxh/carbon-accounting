# Motion review — 2026-09-24

Reviewed with `review-animations` and `find-animation-opportunities` against `web/DESIGN.md`. Applied items are in the same commit as this file.

## Before / After

| Before | After | Why |
| --- | --- | --- |
| `.btn:active { transform: translateY(1px) }`, `transition 0.15s ease` | `scale(0.97)`, `transition: transform var(--dur-press) var(--ease-out)` | Press feedback should read as the button giving under the finger; 160 ms ease-out, transform only |
| Document card `motion.li layout … exit={{ height: 0 }}` | `exit={{ opacity: 0, transform: "scale(0.98)" }}`, no `layout` | `height` is a layout property; layout animations drop frames while uploads are in flight |
| `motion` shorthands `y: 6`, `y: 8`, `y: -4` across pages | full `transform: "translateY(6px)"` strings | Shorthands run on the main thread; transform strings are compositor-accelerated |
| Inventory row expand: opacity + translate, 180 ms | opacity only, `var(--dur-fast)` (150 ms) | Rows are opened many times per session; motion must be near-imperceptible |
| Chat "thinking" dots `animate-bounce` | opacity pulse, staggered | Bounce is decorative; a pulse still indicates state without drawing the eye |
| Sign-in entrance 500–550 ms with ad-hoc `[0.22,1,0.36,1]` | `var(--dur-enter)` (220 ms) with `var(--ease-out)` | Product UI stays inside the enter budget; one easing curve everywhere |
| Landing `Reveal` and hero use `y` shorthand, ad-hoc ease | transform strings, `var(--ease-out)`, `var(--dur-reveal)` | Same reasoning; the 600 ms budget is allowed only here |
| `.rise` keyframe on the account menu | removed; Base UI `data-starting-style` transition at `var(--dur-fast)` from `--transform-origin` | Transitions are interruptible; popovers scale from their trigger |
| Skeleton shimmer runs forever | pauses when off-screen (IntersectionObserver toggles `animation-play-state`) | Looping animations off-screen burn battery for nothing |
| Coverage strip cells appear at once | cells fade in left→right on first paint via `@starting-style`, 20 ms stagger, no re-animation on update | Explanation: reads as "the year filling in"; runs once per page load |
| Lineage mock on the landing renders static | steps reveal in sequence with `clip-path: inset()` when scrolled into view; the total counts up with NumberFlow | Explanatory marketing animation of the product's core promise; rare, once |

## Kept as-is

- `animate-spin` on the upload and recompute spinners: constant motion, linear, correct.
- OTP fake caret `animate-pulse`: mimics a native caret.
- Dialog backdrop/popup transitions from Base UI at `var(--dur-enter)`.
- Sonner enter/exit (library defaults, transform + opacity).

## Rejected (do not add)

| Candidate | Verdict |
| --- | --- |
| Stepper numeral → check morph on step completion | Fires on every page navigation (tens/day). Rejected on frequency. |
| Hover lift or shadow growth on cards and rows | Tens of times a day, decorative. Rejected. |
| Row expand height animation | Layout property, and rows open constantly. Rejected. |
| Animated chart bars on load | Inventory loads often; bars are data, not delight. Rejected. |
| Chat bubble slide-in beyond 150 ms opacity | Sending a message is a frequent action. Kept to a 150 ms fade. |
| Any animation on keyboard-initiated actions (Enter to send, Escape to close) | Rejected by rule. |
| Landing hero text animation (typewriter, split-letter) | Delays the headline the visitor came to read. Rejected. |
