---
name: Project Savannah
description: A calm, precise operations console for producing AI-assisted YouTube Shorts end to end.
colors:
  field-green-50: "#eef8f2"
  field-green-100: "#d8efe1"
  field-green-200: "#b3dfc5"
  field-green-300: "#82c69f"
  field-green-400: "#4da978"
  field-green-500: "#2f8b5b"
  field-green-600: "#236f48"
  field-green-700: "#1d593b"
  field-green-800: "#194830"
  field-green-900: "#153b29"
  background: "#f4f7f5"
  surface: "#ffffff"
  surface-muted: "#f7f9f7"
  border: "#dce5de"
  border-strong: "#c6d2c9"
  text-primary: "#17231b"
  text-secondary: "#627067"
  text-muted: "#879189"
  text-on-brand: "#ffffff"
  info-background: "#edf5ff"
  info-text: "#225b9b"
  info-border: "#c8ddf5"
  success-background: "#edf8f1"
  success-text: "#216e43"
  success-border: "#bfe1cc"
  warning-background: "#fff8e8"
  warning-text: "#8a5a10"
  warning-border: "#ecd39d"
  danger-background: "#fff0f0"
  danger-text: "#a13737"
  danger-border: "#efc2c2"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "clamp(25px, 4vw, 36px)"
    fontWeight: 800
    lineHeight: 1.05
  page-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "clamp(26px, 4vw, 34px)"
    fontWeight: 700
    lineHeight: 1.15
  section-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.5
  card-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 800
    lineHeight: 1.5
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.5
  eyebrow:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.5
    letterSpacing: "0.11em"
rounded:
  small: "8px"
  medium: "12px"
  large: "18px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "48px"
  8: "64px"
components:
  button-primary:
    backgroundColor: "{colors.field-green-600}"
    textColor: "{colors.text-on-brand}"
    rounded: "{rounded.small}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.field-green-700}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.small}"
    padding: "9px 15px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-muted}"
  button-danger:
    backgroundColor: "{colors.danger-text}"
    textColor: "{colors.text-on-brand}"
    rounded: "{rounded.small}"
    padding: "9px 15px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.large}"
    padding: "20px 22px"
  badge-success:
    backgroundColor: "{colors.success-background}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.pill}"
  badge-warning:
    backgroundColor: "{colors.warning-background}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.pill}"
  badge-danger:
    backgroundColor: "{colors.danger-background}"
    textColor: "{colors.danger-text}"
    rounded: "{rounded.pill}"
  badge-info:
    backgroundColor: "{colors.info-background}"
    textColor: "{colors.info-text}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.small}"
    padding: "9px 12px"
---

# Design System: Project Savannah

## Overview

**Creative North Star: "The Field Console"**

Project Savannah's application UI is an instrument panel for an unmanned production line, not a showcase. It exists so one operator can watch idea generation, script approval, SEO, rendering, and publishing happen automatically, and step in the moment something needs a human decision. The room is quiet by design: pale, neutral surfaces (`#f4f7f5` background, white `#ffffff` cards) do the load-bearing work, and Field Green — the brand's mid-saturation forest accent — carries the interface's identity and active-process signal: the sidebar's own brand mark, established app/page eyebrow and kicker treatments, the page's dominant primary action, active navigation and focus states, and the progress bar and active-pipeline-step treatments that show work actually happening right now. It is never used to represent semantic status — success, warning, danger, and info each carry their own dedicated background/text/border palette, entirely separate from the brand scale.

The system is restrained, not austere — it already contains two purely decorative, ambient background blobs drifting slowly behind page content, and a functional gradient shimmer on the active progress bar; both are real, intentional, and part of the incumbent design. What the system rejects is gratuitous decoration that competes with workflow clarity: enterprise-dashboard clutter (cramped tables, tiny type, toolbars stacked three deep) and playful or toy-like affordances (bouncy motion, cartoon iconography, saturated multi-color chrome) are still out. New decorative or motion treatments are welcome only when they match the incumbent bar — subtle, purposeful, and consistent with what's already here — not as a license to add illustration or effects for their own sake.

**Key Characteristics:**
- Field Green carries Savannah's brand identity and active-process signal — the sidebar mark, established eyebrow/kicker treatments, the dominant primary action, active navigation/focus, and progress/active-pipeline treatments — never semantic status, which uses its own dedicated palettes.
- The system already contains two purely decorative ambient background blobs and a functional progress-bar shimmer; these set the ceiling for how much new decoration this system tolerates — subtle, slow, and purposeful.
- Flat, softly-bordered neutral surfaces; depth is a whisper, not a statement.
- A single sans-serif type family carries every role, from an 11px eyebrow to a 36px display number.
- Keep one visually dominant primary action per page or task context; other actions should remain secondary or destructive according to their role — secondary actions stay bordered rather than filled.
- Status always carries a non-color cue (text, icon, or shape) at minimum — badges and alerts use the full triad, compact indicators may use less, but color alone is never enough.

## Colors

The reusable token palette is one Field Green accent scale, a neutral scale for structure and text, and four semantic status triads (background/text/border) for success, warning, danger, and info. A small number of purpose-specific implementation literals exist outside the reusable token palette, such as the cool ambient background color and danger-button hover treatment; these are existing exceptions, not additional reusable color families.

### Primary
- **Field Green** (`#2f8b5b`, `--color-brand-500`): Savannah's brand, interaction, and active-process accent — not a semantic status color. It marks the application's own identity (the sidebar brand mark, `.sidebar-logo`, fills brand-600) and established app/page eyebrow and kicker treatments (brand-600 text); it drives interaction (primary buttons fill brand-600 at rest, brand-700 hover; the active navigation wash is brand-50/brand-700; focus rings are brand-200); and it signals active process (the default progress-bar fill is brand-500, its active-state shimmer is a brand-400/600/400 gradient, and the active pipeline-step icon fills brand-600 with a brand-50 ring). Full 10-step scale, dark → light: `#153b29` (900) · `#194830` (800) · `#1d593b` (700) · `#236f48` (600) · `#2f8b5b` (500) · `#4da978` (400) · `#82c69f` (300) · `#b3dfc5` (200) · `#d8efe1` (100) · `#eef8f2` (50). Success, warning, danger, and info each use their own dedicated triad below — none of them borrow from this scale, even when a process is complete or a status is good.

### Neutral
- **Background** (`#f4f7f5`): the app canvas behind every card and panel.
- **Surface** (`#ffffff`): cards, panels, inputs, modals — anything that reads as "on top of" the background.
- **Surface Muted** (`#f7f9f7`): hover states for secondary buttons and nav links, disabled field backgrounds, and the progress bar's track.
- **Border** (`#dce5de`) / **Border Strong** (`#c6d2c9`): hairline dividers and card edges use Border; input strokes and hover states needing more definition use Border Strong.
- **Text Primary** (`#17231b`), **Text Secondary** (`#627067`), **Text Muted** (`#879189`): a three-step text hierarchy — primary for headings and body copy, secondary for supporting copy and nav labels at rest, muted for the least important line in a stack.
- **Text on Brand** (`#ffffff`): the only text color ever placed on a filled Field Green or danger surface.

### Status
Every status carries a background/text/(often border) treatment drawn from these dedicated triads — never bare color, and never borrowed from the Field Green scale. Badges and alerts always use the full triad; compact indicators (a health score, a live dot, a pipeline-step icon) may use a lighter subset of it, but always paired with text, iconography, or shape:
- **Success**: `#edf8f1` / `#216e43` / `#bfe1cc`
- **Warning**: `#fff8e8` / `#8a5a10` / `#ecd39d`
- **Danger**: `#fff0f0` / `#a13737` / `#efc2c2`
- **Info**: `#edf5ff` / `#225b9b` / `#c8ddf5`

### Named Rules
**The Controlled Accent Rule.** Field Green is Savannah's brand, interaction, and active-process accent. Use it for established brand marks, the visually dominant primary action, active navigation/focus treatments, and existing progress/active-process patterns. Do not substitute it for semantic success, warning, danger, or info.

**The Status Clarity Rule.** Badges and alerts pair their background tint with matching text and border colors from the same semantic group — the full triad. Compact status indicators (a health score, a live dot, a pipeline-step icon) may use a semantic text/background or icon/dot treatment without the full triad, as already implemented — but no status, in any form, may rely on color alone; it must always carry accompanying text, iconography, shape, or another non-color cue.

## Typography

**Body & Display Font:** Inter (with `-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`)
**Monospace Font:** SFMono-Regular (with `Consolas, "Liberation Mono", Menlo, monospace`) — defined in `Variables.html` (`--font-family-monospace`) for future use; not currently applied by any view template.

**Character:** One typeface carries every role in the product. Hierarchy comes from size and weight, never from mixing families. Five weight tokens are defined (`--font-weight-regular` 400, `medium` 500, `semibold` 600, `bold` 700, `extra-bold` 800), but only regular, bold, and extra-bold are actually consumed anywhere in the current CSS — medium and semibold are reserved, unused headroom in the scale.

### Hierarchy
- **Display** (extra-bold/800, `clamp(25px, 4vw, 36px)`, line-height `1.05`): `.app-brand` — the product wordmark only, not used for page content.
- **Page Title** (bold/700, `clamp(26px, 4vw, 34px)`, line-height `1.15`/tight): `.page-title` — each workspace's H1.
- **Section Title** (bold/700, 19px, line-height `1.5`/normal, inherited — no override): `.section-title` — groups cards or panels within a page.
- **Card Title** (bold/700, 17px, line-height `1.5`/normal, inherited): `.card-title` — a card's own heading. (`.list-card-title` reuses the smaller 15px Body size at the same bold weight for a quieter list-row title.)
- **Body** (regular/400, 15px, line-height `1.5`/normal): default paragraph and content copy.
- **Small** (regular/400, 14px, line-height `1.5`): secondary copy such as `.section-description`.
- **Label** (extra-bold/800, 13px): `.form-label` — form field labels. Two adjacent card/KPI label classes (`.card-label`, `.kpi-label`) reuse the same 13px size at bold/700 instead — a deliberately quieter sibling treatment for stat-card captions, not an inconsistency to "fix."
- **Caption** (12px): weight varies by context — extra-bold/800 for `.badge` and `.table th`, bold/700 for `.app-version` and most meta text.
- **Eyebrow** (extra-bold/800, 11px, uppercase, color Field Green brand-600): kicker labels above a title. Letter-spacing is `0.11em` for page/section/hero eyebrows; `.app-brand`'s own eyebrow (`.app-eyebrow`) uses `0.14em`. (`.topbar-eyebrow` is a separate, smaller 10px label in Text Muted, outside this token role — not every eyebrow-styled label in the system uses Field Green.)

A secondary, token-external pattern sits above this hierarchy: large extra-bold "stat numerals" (`.kpi-value` 32px, `.card-value`/`.dashboard-cost-value` 28px, `.dashboard-total-card strong` 27px, `.ideas-summary-card strong` 24px), each at line-height `1`–`1.2`. These are literal pixel values, not drawn from the named `--font-size-*` scale, and exist specifically for KPI/stat headline numbers inside cards — distinct from Display, which is reserved for the app wordmark.

### Named Rules
**The One Family Rule.** Inter carries every role in the system. A second family is never introduced for "personality" — weight and size changes do that job.

## Layout

The shell is a two-column CSS grid: a fixed sidebar (`240px` via `--sidebar-width`, collapsing to `72px` via `--sidebar-collapsed-width`) beside a fluid content column (`minmax(0, 1fr)`), capped by a max content width of `1240px` (`--page-width`). Inside the content column, the workspace stacks three grid rows — a `72px` header (`--header-height`), a scrolling content area, and a `40px` footer (`--footer-height`) — so header and footer stay pinned while only the middle scrolls.

Responsive behavior collapses in five stages, widest to narrowest: at `1180px` the dashboard, KPI/total, and ideas-summary stat grids (`Components.html`) drop from their wide column count to 2 columns; at `1100px` the topbar status readout hides and search narrows; at `960px` the generic `.grid-3`/`.grid-4` utility grids drop to 2 columns; at `900px` the sidebar becomes a fixed, off-canvas panel (`translateX(-102%)` at rest, sliding in on toggle over `--transition-normal` (`250ms ease`) with a `--shadow-large` cast once open) and body scrolling shifts to the page; at `680px` the shell narrows further, headers stack, all `.grid-2`/`.grid-3`/`.grid-4` utility grids collapse to a single column, page actions go full-width, and the topbar compresses further for phone widths.

Spacing runs an 8-step scale from `4px` to `64px` (`--space-1` through `--space-8`), used consistently for gaps, card padding, and section rhythm rather than one-off pixel values.

Stacking order runs six explicit z-index tiers, lowest to highest: base (`0`) → sticky (`100`) → dropdown (`200`) → overlay (`300`, used by the off-canvas sidebar) → modal (`400`) → toast (`500`).

### Ambient Background (existing, decorative)

Two soft, blurred radial-gradient blobs sit behind page content, explicitly marked in source as "Purely decorative": one warm (`radial-gradient` from `--color-brand-200` to transparent, `ambient-drift-one` `26s ease-in-out infinite`), one cool (`radial-gradient` from `#cfe3ff` — a one-off literal, not a reusable token — to transparent, `ambient-drift-two` `32s ease-in-out infinite`). Both are `blur(70px)`, `opacity: 0.4`, drifting a few percent in position and scale. This is Savannah's only page-level decorative effect, and it establishes the ceiling for how much decoration this system tolerates — subtle, slow, low-opacity, and never competing with content.

## Elevation & Depth

Shadows are ambient, not structural — a soft, low-opacity cue that a surface is a surface, not a signal of stacking order. All three shadow tokens use a dark-green-tinted rgba (`rgba(23, 35, 27, …)`) rather than pure black, so depth reads as part of the palette:
- **Small** (`0 1px 3px rgba(23, 35, 27, 0.06)`): default card and badge resting shadow.
- **Medium** (`0 10px 30px rgba(23, 35, 27, 0.08)`): dropdowns, popovers, the notification panel.
- **Large** (`0 20px 50px rgba(23, 35, 27, 0.12)`): the off-canvas mobile sidebar once open, modals.

### Motion

Two motion registers exist, and they are not interchangeable. The `150ms`/`250ms`/`400ms` transition tokens (`--transition-fast`/`normal`/`slow`) cover ordinary interactive state changes — hovers, focus, color and border shifts. A separate set of longer, purpose-built animations exists outside that token trio, each tied to a specific piece of system-state communication rather than a generic interaction: card entrance (`fade-in-up`, `480ms ease both`, staggered `45ms` per sibling), the progress bar's width transition (`500ms ease`) and its active-state shimmer (`progress-bar-shimmer`, `1.6s linear infinite`), the active-pipeline-step's review-required pulse (`pipeline-pulse`, `1.8s ease-in-out infinite`), a loading spinner (`dashboard-spin`, `750ms linear infinite`), and the two ambient background blobs' drift (`ambient-drift-one` `26s`, `ambient-drift-two` `32s`, both `ease-in-out infinite`). `prefers-reduced-motion: reduce` disables the shimmer and the button hover lift, and collapses transition/animation durations globally — this must be preserved for any new purpose-built animation, not just the token-scale ones.

### Named Rules
**The Whisper Rule.** No shadow in the system is meant to be consciously noticed. If a shadow draws the eye before the content does, it's too strong for this world.

**The Restrained Decoration Rule.** Do not introduce gratuitous decorative flourishes or visual effects that compete with workflow clarity. Preserve Savannah's existing restrained ambient background treatment and functional progress/active-state effects. New decorative treatments must remain subtle, purposeful, and consistent with the incumbent system.

**The Two-Register Motion Rule.** Use the 150/250/400ms token scale for ordinary interactive state changes. Longer purpose-built animation is allowed only where already established for progress, entrance, ambient, or system-state communication, with `prefers-reduced-motion` behavior preserved.

## Shapes

Three radius steps plus a pill, applied by role: `8px` (small) for buttons, inputs, and small controls; `12px` (medium) for mid-sized containers; `18px` (large) for cards, empty states, and anything meant to read as a "room" rather than a "control"; `999px` (pill) exclusively for badges and the progress bar. Borders are hairline (`1px`) and low-contrast at rest (Border), stepping up to Border Strong only on inputs and hover states that need more definition. Nothing in the system uses a hard, unrounded corner.

## Components

Every primitive shares two moves at minimum: flat at rest, and a one-step color/border shift on hover. Focus treatment is component-specific, not universal: buttons and navigation links use a `3px` Field Green (`#b3dfc5`, brand-200) focus-visible outline with `2px` offset; inputs instead shift their border to Field Green (`#2f8b5b`, brand-500) and gain a `3px` brand-100 glow — no outline. Buttons and sidebar nav links additionally move on hover — buttons lift `1px` (`translateY(-1px)`), nav links nudge `2px` right (`translateX(2px)`) — the only two translate-based hover effects in the system.

**Structured and dependable** is the guiding line: visible borders, even padding, predictable states — built for an operator scanning the same screens for hours, not for a first-impression showcase.

### Buttons
- **Shape:** `8px` radius, min-height `40px`, padding `9px 15px`; small variant drops to `34px` min-height / `6px 11px` padding / 13px (Label-size) text.
- **Primary:** Field Green `#236f48` fill, white text, `700` weight (the shared `.button` base weight — all variants share it); hover deepens to `#1d593b`.
- **Secondary:** white fill, Border outline, primary-text color; hover swaps to Surface Muted fill with Border Strong outline.
- **Danger:** filled `#a13737`, white text; hover deepens to `#842d2d`.
- **Disabled:** `0.55` opacity, cursor `not-allowed`, hover lift removed.

### Badges
- **Style:** pill radius, `5px 9px` padding, `800`-weight caption-size (12px) text, `1px` border in the matching status-border color.
- **Default:** Surface Muted background, Text Secondary, Border-colored outline — used when no specific status applies.
- **Status variants:** success/warning/danger/info each pull background, text, and border from their matching triad.

### Cards
- **Corner Style:** `18px`.
- **Background:** Surface (white) on the Background canvas.
- **Shadow Strategy:** Small ambient shadow at rest; no shadow gain on hover.
- **Border:** `1px solid Border`.
- **Internal Padding:** header `20px 22px 0`, body `20px 22px`, footer `0 22px 20px` — one consistent horizontal rhythm across all three zones.
- **Entrance:** `.card`, `.dashboard-kpi-card`, `.dashboard-total-card`, `.idea-workspace-card`, and `.ideas-summary-card` fade/slide in on render (`fade-in-up`, `480ms ease both`), staggered `45ms` per sibling for the first several cards.

### Inputs / Fields
- **Style:** white fill, `1px solid Border Strong`, `8px` radius, `9px 12px` padding, `42px` min-height; textareas grow to `120px` min-height, resize vertically only.
- **Focus:** border shifts to Field Green (`#2f8b5b`, brand-500) and gains a `3px` soft brand-tint glow (`0 0 0 3px` brand-100) — a glow, not the outline treatment buttons and nav links use.
- **Disabled:** Surface Muted background, Text Muted text, cursor `not-allowed`.

### Navigation
- **Style:** sidebar links (`.sidebar-nav-link`) are `42px` min-height, `9px 11px` padding, `9px` radius, `13px`/`700`-weight text in Text Secondary, with a `20px` icon slot (19px inline SVG, `1.8` stroke-width, `currentColor`).
- **Hover:** Surface Muted background, text deepens to Text Primary, link nudges `2px` right.
- **Active:** Field Green wash — brand-50 background, brand-700 text — plus a `3px` solid brand-600 inset left border (`box-shadow: inset 3px 0 0`); no icon color change beyond the inherited `currentColor` text shift.
- **Mobile:** the sidebar becomes a fixed off-canvas panel sliding in from the left with a Large shadow once open, rather than a separate mobile nav pattern.
- **Secondary pattern:** a separate, simpler `.nav-link` / `.nav-link-active` pair also exists (14px/Small text, solid brand-600 fill + white text when active, no wash/inset-border treatment) for tab-style in-page navigation, distinct from the sidebar's wash treatment.

### Progress Bar
- **Track:** `8px` height, pill radius, Surface Muted background, `overflow: hidden`.
- **Fill (default):** Field Green (`#2f8b5b`, brand-500), width transitions over `500ms ease`.
- **Fill (active, `data-active="true"`):** a brand-400/600/400 linear gradient shimmer (`progress-bar-shimmer`, `1.6s linear infinite`); disabled under `prefers-reduced-motion`.

### Pipeline / Process Steps
- **Step icon:** `42px` circle, `2px` border, Surface background, Text Muted icon color at rest; border/background/color/transform transition over `--transition-normal` (`250ms ease`).
- **Active step:** Field Green fill (brand-600) with a brand-50 ring (`box-shadow: 0 0 0 5px`); the step's count badge also washes brand-50/brand-700.
- **Review-required step:** Info triad (border/background/text), with a `pipeline-pulse` box-shadow animation (`1.8s ease-in-out infinite`), disabled under `prefers-reduced-motion`.
- **Building step:** Warning triad (border/background/text), no animation.

## Do's and Don'ts

### Do:
- **Do** keep one visually dominant primary action per page or task context; other actions should remain secondary or destructive according to their role.
- **Do** use Field Green for Savannah's brand marks, the primary action, active navigation/focus, and established progress/active-process patterns — never for semantic success, warning, danger, or info.
- **Do** give every status indicator a non-color cue at minimum — text, icon, or shape. Badges and alerts use the full background/text/border triad; compact indicators (a health score, a live dot, a pipeline-step icon) may use a lighter treatment, as already implemented.
- **Do** match focus treatment to control type: the `3px` Field Green outline (brand-200, `2px` offset) on buttons and navigation links; the brand-500 border + `3px` brand-100 glow on inputs. These are the system's two focus treatments, not one universal style.
- **Do** preserve Savannah's existing ambient background blobs and progress/active-state gradient effects — they're intentional and set the ceiling for how much decoration this system tolerates.
- **Do** use the 150/250/400ms token scale for ordinary interactive state changes; longer purpose-built animation (card entrance, progress fill/shimmer, pipeline pulse, ambient drift) is allowed only where already established, with `prefers-reduced-motion` behavior preserved.
- **Do** keep shadows ambient and never use them to fake stacking order that spacing and color already communicate.
- **Do** treat light mode as the only supported theme right now. A `[data-theme="dark"]` stub exists in `Themes.html` (`color-scheme: dark` only, explicitly commented "deliberately not enabled yet") — don't design or ship dark-specific screens or invent dark token values from that stub.

### Don't:
- **Don't** use Field Green as a stand-in for semantic success (or any other status) — even in contexts where both could plausibly appear (e.g., a completed job), they come from different palettes and mean different things.
- **Don't** introduce a second typeface. Inter carries every role via size and weight alone.
- **Don't** introduce gratuitous decorative flourishes or visual effects that compete with workflow clarity. New decoration must remain as subtle and purposeful as the incumbent ambient blobs and progress shimmer — this is not a license to add illustration or effects for their own sake.
- **Don't** use bounce, elastic, or cartoon-style motion, and don't invent animation durations outside the two established registers: the 150/250/400ms interaction tokens, or an existing longer purpose-built pattern (480ms card entrance, 500ms progress width, 1.6s shimmer, 1.8s pipeline pulse, 750ms spinner, 26s/32s ambient drift).
- **Don't** stack more than one accent color's worth of emphasis on a screen. Status colors communicate state, not brand emphasis.
- **Don't** design the empty `Frontend/Components/UI/*.html` primitives (Badge, Button, Card, EmptyState, Modal, Spinner, Table, Toast) as new components from scratch — they should become thin wrappers around the classes documented here, migrated one workspace at a time (see `COMPONENT_LIBRARY.md`).
