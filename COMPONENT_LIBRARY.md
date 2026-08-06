# Project Savannah Component Library

Inventory of the reusable Apps Script HTML templates under `Frontend/Components`. Visual
rules (color, spacing, typography) live in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this
document tracks which components exist and what they render.

## Layout — implemented

| Component | Renders |
| --- | --- |
| `Layout/Shell.html` | Application frame: composes `Sidebar` and `Header` around the routed page content. |
| `Layout/Header.html` | Top bar: mobile sidebar toggle, current route context. |
| `Layout/Sidebar.html` | Branded sidebar shell that embeds `Navigation/Navigation.html`. |
| `Layout/Footer.html` | App name, version, and live status indicator. |

## Navigation — implemented

| Component | Renders |
| --- | --- |
| `Navigation/Navigation.html` | Primary workspace nav list, highlights the active route. |

## UI primitives — named, not yet implemented

`Badge.html`, `Button.html`, `Card.html`, `EmptyState.html`, `Modal.html`, `Spinner.html`,
`Table.html`, and `Toast.html` under `Frontend/Components/UI` exist as empty files. No
page currently includes them — workspaces (Dashboard, Ideas, Scripts, Production, and so
on) apply the DESIGN_SYSTEM.md classes directly in their own view templates instead of
through a shared primitive.

This is not part of the v1.4 media-pipeline work in [ROADMAP.md](ROADMAP.md). If frontend
consolidation becomes a priority, implement these as thin wrappers around the existing
DESIGN_SYSTEM.md classes and migrate one workspace at a time rather than all at once.
