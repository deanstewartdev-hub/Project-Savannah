# Project Savannah Architecture

Project Savannah is an AI-powered YouTube Shorts automation platform built with a modular,
production-ready architecture.

## Engineering Principles

### 1. Single Responsibility

Each file should have one clear purpose.

Examples:

- `Script_Engine.js` orchestrates script generation.
- `Scripts_Repository.js` reads and writes script records.
- `AI_PromptLibrary.js` builds prompts.
- `AI_OpenAI.js` communicates with OpenAI.

### 2. Layered Architecture

Each feature should follow this flow:

```text
User Action
→ Engine
→ Service
→ AI Provider
→ Repository
→ Google Sheets
```

### 3. Directory Layout

```text
AI            AI service abstraction, providers, schemas, prompt libraries
Analytics     YouTube Analytics snapshots and repository
App           Controllers and app shell/routing
Approval      Approval queue repository
Dashboard     Dashboard UI, widgets, styles, refresh logic
Frontend      HTML views, components, and client-side assets
Ideas         Idea generation workflow and repository
Models        Domain record shapes (Idea, Script, RenderJob, PublishingJob, ...)
Production    Scene planning, voiceover, visuals, rendering, quality gate, publishing
Scripts       Script generation, validation, and formatting workflow
SEO           SEO pack generation and repository
Services      Shared services: logging, costs, settings, secrets, notifications
Setup         Sheet setup, migrations, validation
Tests         Local safe-test fixtures
Utils         General helper utilities
```

## Production pipeline (current, Creatomate-based)

```text
App/ProductionController.js
Models/RenderJob.js
Models/PublishingJob.js
Production/ProductionTask_Repository.js
Production/ProductionQueue_Service.js
Production/ProductionError_Service.js
Production/PublishingSchedule_Service.js
Production/RenderJob_Repository.js
Production/PublishingJob_Repository.js
Production/ScenePlan_Service.js
Production/Voiceover_Service.js
Production/VisualAsset_Service.js
Production/Creatomate_Service.js
Production/RenderQuality_Service.js
Production/RenderReview_Service.js
Production/YouTube_Service.js
Tests/ProductionHardening_Tests.js
```

`Creatomate_Service.js` is being retired under the v1.4 release described in
[ROADMAP.md](ROADMAP.md). It is replaced by a `VideoProcessingProvider` abstraction with
two implementations: `CloudRunFFmpegProvider` (new default) and `CreatomateProvider`
(kept only until the first Cloud Run render is verified good, then deleted). Apps Script's
role in the pipeline shrinks to job submission, polling, and a webhook callback — the
render queue, retries, and media assembly move into the Cloud Run worker, which is not
subject to the six-minute Apps Script execution ceiling.

## Analytics pipeline

```text
App/AnalyticsController.js
Analytics/AnalyticsSnapshot_Repository.js
Analytics/YouTubeAnalytics_Service.js
Frontend/Views/Analytics.html
Frontend/Assets/Scripts/Analytics.html
```

## Monitoring pipeline

```text
App/NotificationController.js
Services/Services_Logging.js
Services/Services_Notifications.js
Frontend/Assets/Scripts/Notifications.html
```

## Google Sheets

Savannah currently uses these worksheets:

- Dashboard
- Settings
- Ideas
- Scripts
- SEO Pack
- Approval Queue
- Production Tasks
- Render Jobs
- Publishing Jobs
- Analytics
- Channel Analytics
- Logs
- Costs

Worksheet schemas are repository-owned. Do not change columns manually without a migration.

## Boundaries

- Frontend files render state and call public Apps Script functions.
- Controllers validate requests and return browser-safe responses.
- Services coordinate provider behavior and production rules.
- Models normalize domain records and statuses.
- Repositories own Google Sheets persistence.
- Provider secrets remain in Apps Script properties and are never committed.
