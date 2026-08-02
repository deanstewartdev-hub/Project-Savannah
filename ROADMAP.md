# Project Savannah Roadmap

Last updated: 2 August 2026
Live Apps Script deployment: version 67
Canonical branch: `sprint-2`

## Overall progress

```text
Phase 1  Foundation Platform        ██████████ 100%
Phase 2  Content Automation         █████████▌  95%
Phase 3  Production Hardening       ███████▊░░  78%
Phase 4  Growth & Analytics         ████░░░░░░  40%
Phase 5  Intelligent Automation     ░░░░░░░░░░   0%
Phase 6  Multi-Channel Platform     ░░░░░░░░░░   0%
Phase 7  Enterprise Platform        ░░░░░░░░░░   0%
```

## Phase 1 — Foundation Platform: 100%

Completed:

- Apps Script layered architecture
- controllers, services, models, and repositories
- workflow engine patterns
- Google Sheets persistence
- application shell, routing, navigation, and design system
- Dashboard, Ideas, Scripts, Approval, SEO, Settings, and Production workspaces
- OpenAI provider abstraction, prompt libraries, logging, and cost records
- Git, GitHub, VS Code, clasp, and versioned deployments

## Phase 2 — Content Automation: 95%

Completed:

- idea generation, review, categories, storage, and metrics
- script generation, repair, validation, formatting, versioning, and approval
- approval queue with approve, reject, return, notes, and status synchronization
- SEO titles, descriptions, tags, hashtags, and keyword output
- OpenAI narration with selectable high-quality voices
- measured narration duration and scene timing
- four-scene planning and narration mapping
- topic-specific AI image prompts and Drive asset cache
- model-neutral scene briefs covering motion, physics, continuity, audio alignment, fallback framing, and cost-aware evaluation
- Creatomate JSON generation, polling, and completed-render history
- YouTube authorization, metadata, private upload, scheduling input, and processing status

Remaining:

- upgrade Creatomate from the low-resolution free trial, then confirm a new MP4 passes the 1080×1920 gate
- add first-class thumbnail generation and selection
- finish end-to-end regression on one new Short after the resolution fix

## Phase 3 — Production Hardening: 78%

### Error handling: 95%

Completed:

- browser-safe error responses and provider-specific messages
- bounded safe retries for Creatomate status reads
- structured production logs with request IDs
- failed task state and per-scene resume
- normalized provider, validation, duplicate, quality, authorization, quota, timeout, and reconciliation error codes
- retry classification, wait times, recovery instructions, request references, and repeated-failure warnings in Production

Remaining:

- optional email notification after repeated unattended worker failures

### Render queue: 80%

Completed:

- persistent Production Tasks sheet
- multiple waiting tasks
- priority field
- per-scene progress
- pause, resume, cancel, and retry states
- optional five-minute background worker implementation
- persistent 1–5 queue priorities with urgent/normal/low controls and priority-first processing

Remaining:

- authorize/install the time trigger
- explicit render cancellation at Creatomate

### Reliability: 80%

Completed:

- Apps Script locks around render submissions, scene generation, and uploads
- active-render duplicate prevention
- pre-provider local render record
- stale render submission recovery
- uncertain YouTube upload reconciliation state
- explicit confirmation before allowing an ambiguous upload retry
- cached audio and visual assets

Remaining:

- webhook-based Creatomate completion
- durable reconciliation against YouTube channel uploads after a timeout

### Quality checks: 80%

Completed:

- success and URL validation
- planned versus actual duration
- 30–60 second product target
- all four visuals, voiceovers, captions, and scene durations
- vertical orientation
- minimum 1080×1920 resolution
- required model-ready visual briefs for new render plans
- final human approval gate

Remaining:

- automated silence detection
- black/frozen-frame detection
- loudness target and clipping detection
- visual-topic relevance scoring

### Scheduling: 80%

Completed:

- private, unlisted, and public visibility selection
- future `publishAt` validation
- scheduled uploads forced private until publication
- timezone-safe ISO conversion from the browser
- upcoming publishing schedule in Production
- one-hour conflict prevention for scheduled Shorts

Remaining:

- recurring schedules and daily slot rules

### Templates and monitoring: 45%

Completed:

- brand colors, voice settings, premium image setting, and four-scene layout
- production job dashboard and automatic polling
- queue worker code and status panel

Remaining:

- authorize the background trigger
- motion presets, transitions, subtitle themes, and music ducking
- email or in-app failure notifications

## Phase 4 — Growth & Analytics: 40%

Existing foundations:

- YouTube read-only authorization
- published video IDs and processing status
- dashboard and cost repositories
- Analytics workspace and navigation
- hourly-deduplicated YouTube metric snapshots
- views, likes, comments, duration, privacy, and per-video growth deltas
- first live snapshot captured for five Savannah uploads
- channel subscriber, total-view, and public-video baselines
- responsive subscriber and channel-view growth charts across the latest 30 snapshots

Next:

- add YouTube Analytics API ingestion for watch time, retention, subscribers, and revenue where available
- schedule daily metric snapshots after trigger authorization
- add channel health scoring and alerts
- compare topics, hooks, durations, and upload times
- combine OpenAI and render cost with video performance
- daily, weekly, and monthly reports

## Phase 5 — Intelligent Automation: 0%

Planned after reliable analytics data exists:

- hook, title, thumbnail, and pacing performance models
- bulk idea ranking and automatic selection
- trend and seasonal topic detection
- controlled title and thumbnail experiments
- performance feedback into future ideas

## Phase 6 — Multi-Channel Platform: 0%

Planned:

- channel profiles, voices, templates, branding, prompts, and schedules
- per-channel YouTube authorization and publishing
- editors, reviewers, approval roles, and shared assets

## Phase 7 — Enterprise Platform: 0%

Long-term:

- multi-user workspaces and permissions
- REST API and webhooks
- migration from Sheets to a cloud database when scale requires it
- specialized research, SEO, thumbnail, trend, publishing, and analytics agents
- subscriptions, templates marketplace, and white-label workspaces

## Immediate release checklist

- [x] Persist scene preparation progress
- [x] Add pause/resume/cancel controls
- [x] Protect render and upload actions from duplicates
- [x] Add uncertain-upload reconciliation
- [x] Enforce narration, caption, visual, duration, orientation, and resolution gates
- [x] Deploy Phase 3 hardening to the existing web app
- [ ] Upgrade Creatomate (currently 49/50 trial credits; trial output is clamped to 270×480)
- [ ] Verify the first post-upgrade full-HD Creatomate render
- [ ] Approve the full-HD render after visual review
- [ ] Upload the verified replacement to YouTube as private
- [ ] Enable background worker authorization
- [ ] Run full Apps Script regression suite
- [ ] Commit and push the verified milestone to GitHub
