# Project Savannah

Project Savannah is an AI-assisted YouTube Shorts production platform. It turns an approved idea into a validated script, SEO metadata, narrated scene plan, rendered vertical video, final human review, and a private or scheduled YouTube upload.

GitHub branch `sprint-2` is the source of truth. Google Apps Script is deployed from this repository with clasp.

## Current state

| Item | Value |
| --- | --- |
| Application | Project Savannah v1.3 |
| Active branch | `sprint-2` |
| Runtime | Google Apps Script V8 |
| Persistence | Google Sheets and Google Drive |
| AI | OpenAI through the provider service layer |
| Rendering | Creatomate |
| Publishing | YouTube Data API |
| Channel | Savannah Atlas |
| Live deployment | Apps Script version 61 |
| Deployment ID | `AKfycbzfD4HhW82TJyrdl5wteB1L84uiQJqb_hANd106zLDOOpY4HKqclGv67noe-kpQn2vDDw` |
| Last verified | 2 August 2026 |

Current external blocker: Creatomate's free trial clamps output to 270×480 and has used 49 of 50 credits. The automated gate correctly blocks those renders. Upgrade the renderer before producing the first publishable 1080×1920 replacement.

The full roadmap and live phase percentages are maintained in [ROADMAP.md](ROADMAP.md). Items that require Dean's authorization are maintained in [APPROVALS_REQUIRED.md](APPROVALS_REQUIRED.md).

## Operational workflow

```text
Generate ideas
→ approve idea
→ generate and validate script
→ repair and format when required
→ send for review
→ approve script
→ generate SEO pack
→ prepare four narrated scenes
→ create four topic-matched visuals
→ render vertical MP4
→ run automated quality gate
→ approve finished video
→ upload privately or schedule on YouTube
```

Confirmed production capabilities:

- Ideas, scripts, approvals, SEO packs, voiceover, scene plans, visuals, renders, and publishing jobs are persisted.
- OpenAI narration uses `gpt-4o-mini-tts`, selectable voices, speed, and voice instructions.
- Scene timing is fitted to measured MP3 narration duration.
- Scene visuals are generated and cached in Google Drive.
- Preparation progress is persisted per scene and can be resumed, paused, or cancelled.
- Cost-incurring render and upload actions use duplicate guards and Apps Script locks.
- Stale render submissions and uncertain YouTube uploads enter explicit recovery states.
- Completed renders must pass duration, asset, narration, caption, orientation, and resolution checks before approval.
- Human approval is required before a YouTube upload.
- YouTube visibility defaults to private and scheduled uploads remain private until `publishAt`.

## Architecture

```text
Frontend
  → Apps Script controller
    → workflow/service
      → model and repository
        → Google Sheets / Drive
      → OpenAI / Creatomate / YouTube
```

Important boundaries:

- Frontend files render state and call public Apps Script functions.
- Controllers validate requests and return browser-safe responses.
- Services coordinate provider behavior and production rules.
- Models normalize domain records and statuses.
- Repositories own Google Sheets persistence.
- Provider secrets remain in Apps Script properties and are never committed.

Production-specific files:

```text
App/ProductionController.js
Models/RenderJob.js
Models/PublishingJob.js
Production/ProductionTask_Repository.js
Production/ProductionQueue_Service.js
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

Analytics-specific files:

```text
App/AnalyticsController.js
Analytics/AnalyticsSnapshot_Repository.js
Analytics/YouTubeAnalytics_Service.js
Frontend/Views/Analytics.html
Frontend/Assets/Scripts/Analytics.html
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

## Local development

Requirements:

- Git
- Node.js
- VS Code
- `@google/clasp`
- Access to the Savannah Apps Script project and spreadsheet

```powershell
git clone https://github.com/deanstewartdev-hub/Project-Savannah.git
cd Project-Savannah
git switch sprint-2
npx --yes @google/clasp@latest status
```

Normal release flow:

```powershell
git status
git diff --check
npx --yes @google/clasp@latest push --force
npx --yes @google/clasp@latest version "Description"
npx --yes @google/clasp@latest deploy --deploymentId <deployment-id> --versionNumber <version>
git add <reviewed-files>
git commit -m "Description"
git push origin sprint-2
```

Do not run `clasp pull` unless the Apps Script copy is intentionally becoming canonical; it can overwrite newer local work.

## Testing

Safe local checks:

- Run `node --check` across server-side JavaScript.
- Extract each frontend `<script>` block and parse it with Node.
- Run the pure production hardening fixtures from `Tests/ProductionHardening_Tests.js` with mocked Apps Script globals.

Apps Script safe test entry point:

```javascript
runProductionHardeningTests()
```

The suite currently checks:

- persisted preparation progress;
- interrupted submission state;
- valid vertical render quality;
- missing narration rejection;
- low-resolution rejection.

Paid provider tests and real uploads must be clearly identified because they consume credits or create external records.

## Security and publishing rules

- Never commit API keys, OAuth tokens, or script properties.
- Sanitize provider errors before returning them to the browser.
- Do not retry ambiguous YouTube uploads until YouTube Studio has been checked.
- Do not publish publicly without an explicit user choice.
- Keep AI-voice disclosure in YouTube descriptions.
- Preserve existing private uploads unless deletion is explicitly requested.

## Definition of done

A change is complete only when:

- intended files pass syntax and focused regression tests;
- the Apps Script push succeeds;
- the deployed web app loads and the affected workflow is smoke-tested;
- paid or external actions are verified separately;
- `git diff --check` passes;
- the roadmap and approval list are current;
- the commit is pushed to `sprint-2`.
