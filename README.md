# Project Savannah

Project Savannah is an AI-powered YouTube Shorts automation platform designed to manage the complete content-production workflow from idea generation through scripting, review, approval, SEO preparation, production and eventual publishing.

The project is built as a standalone Google Apps Script web application. Google Sheets acts as the initial persistence layer, while a modular Apps Script backend provides controllers, workflow engines, repositories, AI integrations, validation, formatting, logging, cost tracking and application routing.

---

## Current Project State

| Item                          | Current value                               |
| ----------------------------- | ------------------------------------------- |
| Application version           | v1.3                                        |
| Active development branch     | `sprint-2`                                  |
| Current sprint                | Sprint 2                                    |
| Frontend version              | v1.3                                        |
| Scripts Controller generation | v1.2                                        |
| Runtime                       | Google Apps Script V8                       |
| Database                      | Google Sheets                               |
| Source control                | Git and GitHub                              |
| Apps Script synchronisation   | clasp                                       |
| AI provider                   | OpenAI through the project AI service layer |
| Video renderer                | Creatomate                                  |
| YouTube channel               | Savannah Atlas                              |
| Live Apps Script version      | v31                                         |

GitHub is the canonical source of truth for the project.

Changes should be implemented locally, pushed to Apps Script through clasp, tested, committed to Git and then pushed to GitHub.

---

## End-to-End Milestone

On 30 July 2026, Project Savannah completed its first verified end-to-end automated Short:

| Stage | Result |
| --- | --- |
| Idea | Bizarre Travel Laws You Didn't Know Existed |
| Script | Generated, validated, repaired and approved |
| SEO | Title, description, tags and hashtags generated |
| Voiceover | Generated with OpenAI and delivered through Google Drive |
| Video | Rendered successfully with Creatomate |
| YouTube | Uploaded privately to Savannah Atlas |
| Video ID | `5Ysn6lLQ_WM` |

Verified workflow:

```text
Generate Idea
→ Approve Idea
→ Generate and Validate Script
→ Send for Review
→ Approve Script
→ Generate SEO Pack
→ Generate Voiceover
→ Render Short
→ Upload to YouTube as Private
```

## Current Objective

The production pipeline from an approved script through SEO, media rendering and private YouTube publishing is operational. The next objective is to harden repeat runs, add scheduling and publication controls, improve video-template quality and complete automated status reporting.

Planned workflow:

```text
Script Ready
→ View script
→ Send for review
→ Pending Approval
→ Approval Queue
→ Approve, reject or return for changes
```

The Approval Queue operates on existing saved scripts. Sending a script for review does not generate or save a duplicate script.

---

## Current Working Workflow

The following workflow is currently confirmed as operational:

```text
Generate Ideas
→ Awaiting Review
→ Approve Idea
→ Approved
→ Open Scripts Workspace
→ Automatically Prefill Idea Details
→ Generate Script
→ Validate Script
→ Repair Script When Required
→ Format Script
→ Save Script
→ Update Source Idea to Script Ready
→ View Existing Script
```

Current behaviour includes:

* Ideas can be generated successfully.
* Generated ideas are stored in Google Sheets.
* Ideas can move through `Awaiting Review` and `Approved`.
* Approved ideas can open the Scripts workspace.
* Idea information is automatically prefilled in the script-generation form.
* Scripts can be generated from approved ideas.
* Generated scripts are validated.
* Invalid AI output can be repaired through the script workflow.
* Valid scripts are formatted into their display form.
* Scripts are persisted in the `Scripts` worksheet.
* Successful script generation moves the source idea to `Script Ready`.
* `Script Ready` cards display `View script` instead of `Create script`.
* `View script` loads the latest saved script for the source idea.
* Viewing an existing script does not generate a duplicate.

---

## Architecture

Project Savannah uses a modular, layered architecture.

```text
Frontend User Action
        ↓
Global Apps Script Entry Point
        ↓
Controller
        ↓
Workflow Engine
        ↓
Domain Services
        ↓
AI Provider or Repository
        ↓
Google Sheets
```

### Layer responsibilities

#### Frontend

The frontend renders the web application, handles user interaction and calls server-side Apps Script functions with `google.script.run`.

The frontend must not:

* Access Google Sheets directly.
* Call OpenAI directly.
* contain repository logic.
* contain workflow persistence rules.
* expose internal server errors.

#### Controllers

Controllers form the public backend boundary used by the frontend.

Controllers are responsible for:

* Accepting frontend requests.
* Validating required input.
* Sanitising request data.
* Calling engines and repositories.
* Returning frontend-safe response objects.
* Preventing stack traces and internal implementation details from reaching the browser.

Controllers must not:

* Access spreadsheet ranges directly.
* Call AI providers directly.
* build AI prompts.
* duplicate engine workflow logic.
* render frontend HTML.

#### Engines

Engines coordinate complete business workflows.

Examples include:

* Generating ideas.
* Generating scripts.
* validating AI output.
* repairing invalid output.
* formatting content.
* saving canonical records.
* transitioning workflow statuses.
* logging workflow activity.
* recording estimated AI cost.

#### Repositories

Repositories are the persistence boundary between domain objects and Google Sheets.

Repositories are responsible for:

* Creating or validating worksheet structures.
* Reading records.
* writing records.
* updating records.
* serialising structured fields.
* converting worksheet rows into canonical objects.
* preventing duplicate identifiers.

Repositories must not:

* Call AI providers.
* build prompts.
* make frontend decisions.
* perform creative-quality evaluation.
* render HTML.

#### Models

Models define canonical domain records, required fields, valid statuses and validation rules.

All records should be normalised through their model before being persisted.

#### Services

Shared services provide infrastructure used across workflows, including:

* Settings management.
* secret management.
* logging.
* AI cost tracking.
* provider abstraction.
* reusable utility behaviour.

---

## Folder Structure

```text
Project-Savannah/
│
├── AI/
│   ├── AIService.js
│   ├── OpenAI.js
│   ├── ScriptPromptLibrary.js
│   └── AI-related schemas and provider helpers
│
├── App/
│   ├── App.js
│   ├── AppController.js
│   ├── AppRoutes.js
│   ├── DashboardController.js
│   ├── IdeasController.js
│   ├── QueueController.js
│   ├── ScriptsController.js
│   ├── SeoController.js
│   └── SettingsController.js
│
├── Dashboard/
│   └── Dashboard data, widgets, styles and refresh logic
│
├── Frontend/
│   ├── Index.html
│   └── Frontend templates, navigation, layout, styles and scripts
│
├── Ideas/
│   ├── Idea_Engine.js
│   └── Ideas_Repository.js
│
├── Models/
│   └── Canonical domain models and validation rules
│
├── Scripts/
│   ├── Script_Engine.js
│   ├── Script_Formatter.js
│   ├── Script_Validator.js
│   └── Scripts_Repository.js
│
├── Services/
│   ├── Services_Costs.js
│   ├── Services_Logging.js
│   ├── Services_Secrets.js
│   └── Services_SettingsManager.js
│
├── Setup/
│   └── Spreadsheet setup, validation and migration functions
│
├── Utils/
│   └── Shared utility helpers
│
├── .clasp.json
├── appsscript.json
├── Config.js
├── Constants.js
├── Ideas.js
├── Main.js
├── ARCHITECTURE.md
├── COMPONENT_LIBRARY.md
├── DESIGN_SYSTEM.md
└── README.md
```

Some Apps Script files use underscore-separated filenames because clasp maps local files into the flat Google Apps Script project environment.

---

## Main Application Entry Points

### Web application

The web application begins with the Apps Script `doGet` entry point.

The routing layer resolves the requested page and loads the main frontend template.

Example routes include:

```text
?page=dashboard
?page=ideas
?page=scripts
?page=queue
?page=seo
?page=settings
```

Routing responsibilities are divided between:

```text
App/App.js
App/AppController.js
App/AppRoutes.js
Frontend/Index.html
```

### Frontend-to-backend calls

Frontend server calls use public global Apps Script functions.

Example:

```javascript
google.script.run
  .withSuccessHandler(handleSuccess)
  .withFailureHandler(handleFailure)
  .scriptsGetLatestForIdea({
    ideaId: ideaId
  });
```

The global function delegates to its controller rather than containing business logic itself.

---

## Controller Entry Points

### Ideas

Primary controller:

```text
App/IdeasController.js
```

Related workflow and persistence:

```text
Ideas/Idea_Engine.js
Ideas/Ideas_Repository.js
```

Responsibilities include:

* Loading ideas.
* generating ideas.
* retrieving idea metrics.
* approving or updating idea workflow state.
* exposing frontend-safe idea data.

### Scripts

Primary controller:

```text
App/ScriptsController.js
```

Related workflow and persistence:

```text
Scripts/Script_Engine.js
Scripts/Script_Validator.js
Scripts/Script_Formatter.js
Scripts/Scripts_Repository.js
```

Current public script entry points include:

```javascript
scriptsGenerateScript(request)
scriptsGeneratePreview(request)
scriptsList(request)
scriptsGet(request)
scriptsGetLatestForIdea(request)
scriptsGetMetrics()
```

Important behaviour:

```javascript
scriptsGetLatestForIdea(request)
```

must load the latest existing script for an idea and must not trigger script generation.

### Approval Queue

Planned controller:

```text
App/QueueController.js
```

The queue controller is the intended frontend boundary for:

* Sending scripts for review.
* loading pending approval records.
* approving scripts.
* rejecting scripts.
* returning scripts for changes.
* retrieving Approval Queue metrics.

Queue functionality must be implemented through a dedicated repository and workflow boundary rather than direct spreadsheet manipulation from the frontend.

### Dashboard

Primary controller:

```text
App/DashboardController.js
```

The dashboard controller aggregates frontend-safe metrics and recent workflow information.

### SEO

Primary controller:

```text
App/SeoController.js
```

This controller is reserved for SEO-pack and optimisation workflows.

### Settings

Primary controller:

```text
App/SettingsController.js
```

Settings persistence and resolution are handled through the shared settings service.

---

## Repository Entry Points

### Ideas repository

```text
Ideas/Ideas_Repository.js
```

The Ideas repository is the canonical persistence layer for idea records.

Expected responsibilities include:

* Creating or validating the `Ideas` worksheet.
* saving generated ideas.
* retrieving ideas by ID.
* listing ideas.
* filtering ideas by status.
* updating existing idea records.
* changing idea workflow statuses.
* protecting canonical idea identifiers.

### Scripts repository

```text
Scripts/Scripts_Repository.js
```

The Scripts repository is the canonical persistence layer for scripts.

Current repository operations include:

```javascript
ScriptsRepository.saveScript(script)
ScriptsRepository.saveOrUpdateScript(script)
ScriptsRepository.updateScript(script)
ScriptsRepository.getScriptById(scriptId)
ScriptsRepository.getScriptsByIdeaId(ideaId)
ScriptsRepository.getLatestScriptByIdeaId(ideaId)
ScriptsRepository.getAllScripts()
ScriptsRepository.getScriptsByStatus(status)
ScriptsRepository.getScriptCount()
ScriptsRepository.exists(scriptId)
ScriptsRepository.deleteScriptById(scriptId)
ScriptsRepository.ensureSheet()
```

The Scripts repository rejects duplicate script IDs and validates the worksheet header schema before writing.

### Approval Queue repository

A dedicated Approval Queue repository should become the persistence boundary for queue records.

It should support:

* Creating and validating the `Approval Queue` worksheet.
* sending a script to review.
* preventing duplicate active queue entries.
* loading queue entries by ID.
* loading queue entries by script ID.
* filtering records by approval status.
* approving a queue entry.
* rejecting a queue entry.
* returning a script for changes.
* preserving review notes and timestamps.
* maintaining links between queue, script and source idea records.

The queue controller must not write spreadsheet ranges directly.

---

## Google Sheets Database

Project Savannah currently uses these worksheets:

```text
Dashboard
Settings
Ideas
Scripts
SEO Pack
Approval Queue
Logs
Costs
```

### Worksheet purposes

| Worksheet      | Purpose                                     |
| -------------- | ------------------------------------------- |
| Dashboard      | Human-readable operational summary          |
| Settings       | Runtime and AI configuration                |
| Ideas          | Generated ideas and idea workflow state     |
| Scripts        | Canonical saved scripts                     |
| SEO Pack       | Future SEO metadata and optimisation output |
| Approval Queue | Human-review workflow records               |
| Logs           | Operational and error events                |
| Costs          | Estimated provider usage and cost records   |

The application should access data through repositories and services rather than directly from controllers or frontend code.

---

## Workflow Statuses

Statuses are workflow state, not display-only labels. Status changes should be controlled through dedicated transition functions.

### Idea workflow

Current confirmed idea statuses include:

```text
Awaiting Review
Approved
Script Ready
```

Current transition flow:

```text
Awaiting Review
→ Approved
→ Script Ready
```

Meaning:

* `Awaiting Review` — generated idea is waiting for human review.
* `Approved` — idea has been approved and may be used to generate a script.
* `Script Ready` — at least one script has been generated and saved for the idea.

### Script workflow

Current scripts are generated, validated, formatted and saved before their source idea becomes `Script Ready`.

The next planned script statuses are:

```text
Script Ready
Pending Approval
Approved
Rejected
Changes Requested
```

Planned transition flow:

```text
Script Ready
→ Pending Approval
→ Approved
```

Alternative review outcomes:

```text
Pending Approval
→ Rejected
```

or:

```text
Pending Approval
→ Changes Requested
→ Script Ready
```

Status terminology must remain consistent between:

* Domain models.
* repositories.
* controllers.
* frontend filtering.
* status badges.
* Google Sheets.
* dashboard metrics.
* tests.

---

## Approval Queue Design Rules

The Approval Queue implementation must follow these rules:

1. A saved script is the source of truth for review content.
2. Sending for review must not create another script.
3. A script should not have multiple active pending queue records.
4. Queue records must retain both `Script ID` and `Idea ID`.
5. Queue actions must be performed through the queue controller.
6. Queue persistence must be performed through a queue repository.
7. Script and queue status changes must remain synchronised.
8. Review notes must be preserved.
9. Approval actions must be auditable through logging.
10. Invalid transitions must be rejected.
11. Internal errors must not be returned directly to the browser.
12. Existing idea-generation and script-generation functionality must remain unchanged.

---

## Local Setup

### Requirements

Install:

* Git.
* Node.js and npm.
* Visual Studio Code.
* Google clasp.
* access to a Google account.
* access to the Project Savannah Apps Script project.
* access to the project Google Sheet.
* an OpenAI API key.

Install clasp globally:

```bash
npm install -g @google/clasp
```

Confirm the installation:

```bash
clasp --version
```

Log in:

```bash
clasp login
```

Clone the repository:

```bash
git clone https://github.com/deanstewartdev-hub/Project-Savannah.git
```

Enter the repository:

```bash
cd Project-Savannah
```

Switch to the active branch:

```bash
git checkout sprint-2
```

Pull the latest canonical source:

```bash
git pull origin sprint-2
```

Confirm the branch:

```bash
git branch --show-current
```

Expected output:

```text
sprint-2
```

---

## Apps Script and clasp Configuration

The `.clasp.json` file connects the local repository to the Google Apps Script project.

Do not replace the Apps Script project ID with another project ID unless intentionally moving the application.

Verify clasp status:

```bash
clasp status
```

Open the connected Apps Script project:

```bash
clasp open
```

Pulling from Apps Script is potentially destructive because Apps Script may contain older or manually edited code.

Before using:

```bash
clasp pull
```

confirm that Apps Script contains the version that should become canonical.

GitHub remains the normal source of truth.

---

## Standard clasp Workflow

Before making changes:

```bash
git checkout sprint-2
git pull origin sprint-2
clasp status
```

After replacing a file, save all files in Visual Studio Code.

Push the local source to Apps Script:

```bash
clasp push
```

If clasp asks whether manifest changes should be pushed, inspect the change before accepting.

After the push:

1. Open Apps Script.
2. Confirm the replaced file appears correctly.
3. Run the relevant server-side test functions.
4. Reload the deployed web application.
5. Test the affected frontend workflow.
6. Confirm existing functionality still works.
7. Inspect the `Logs`, `Costs`, `Ideas`, `Scripts` and relevant workflow sheets.

After successful testing:

```bash
git status
git diff
git add <changed-file>
git commit -m "docs: expand project README"
git push origin sprint-2
```

For multiple intentionally changed files:

```bash
git add <file-one> <file-two>
```

Avoid staging unrelated files with `git add .` unless every local change has been reviewed.

---

## Deployment

Project Savannah is deployed as an Apps Script web application.

### Deploy a new version

In Google Apps Script:

1. Select **Deploy**.
2. Select **Manage deployments**.
3. Open the existing web application deployment.
4. Select **Edit**.
5. Choose **New version**.
6. Add a clear deployment description.
7. Confirm the execution identity.
8. Confirm access permissions.
9. Select **Deploy**.
10. Open the deployment URL.
11. Hard-refresh the browser.

Recommended deployment description format:

```text
Project Savannah v1.3 - <feature or fix>
```

Example:

```text
Project Savannah v1.3 - Approval Queue integration
```

### Deployment verification

Verify:

* The application loads without a white screen.
* navigation works.
* the expected frontend version is visible.
* idea cards load.
* approved ideas open the Scripts workspace.
* script forms prefill correctly.
* existing scripts open without generating duplicates.
* new server entry points are callable.
* browser console errors are absent.
* Apps Script execution logs contain no unexpected failures.

A `clasp push` updates the Apps Script source but does not always update the public web-app deployment automatically. Create a new deployment version when the live application must use the changed code.

---

## Testing

Tests are run from the Apps Script editor.

### Scripts Controller tests

Current safe controller tests include:

```javascript
testScriptsControllerRejectsInvalidRequest()
testScriptsControllerListsScripts()
testScriptsControllerMetrics()
testScriptsControllerAll()
```

These tests do not make a live AI request.

`testScriptsControllerAll()` currently verifies:

* Invalid generation requests are rejected.
* stored scripts can be listed.
* script metrics can be loaded.
* controller responses use the expected safe response structure.

### Repository tests

Repository tests should verify:

* Worksheet creation.
* exact header structure.
* record creation.
* record retrieval.
* record updates.
* duplicate-ID prevention.
* filtering by status.
* cleanup of test records.

Repository tests that create records must remove their own test data.

### Engine tests

Engine tests should be separated into:

```text
Safe tests
Live provider tests
```

Safe tests must not make an OpenAI request.

Live AI tests must be clearly named and used deliberately because they can:

* consume API quota.
* create cost records.
* create script records.
* update source idea statuses.
* create log entries.

### Manual regression test

After backend changes, manually verify:

1. Dashboard loads.
2. Ideas page loads.
3. Ideas can be generated.
4. Generated ideas show `Awaiting Review`.
5. An idea can be approved.
6. The approved idea opens the Scripts workspace.
7. The script form is prefilled.
8. A script can be generated.
9. The script validates and formats.
10. The script is saved once.
11. The source idea becomes `Script Ready`.
12. The card displays `View script`.
13. `View script` loads the saved script.
14. No duplicate script row is created.
15. Logs contain the expected workflow events.
16. Cost records are created only for live AI calls.

Approval Queue regression steps should be added when the workflow is implemented.

---

## Response Contract

Controllers should return predictable frontend-safe objects.

Successful response example:

```javascript
{
  success: true,
  statusCode: 200,
  requestId: "REQ-...",
  message: "Operation completed successfully.",
  data: {},
  controllerVersion: "..."
}
```

Error response example:

```javascript
{
  success: false,
  statusCode: 400,
  requestId: "REQ-...",
  message: "The operation could not be completed.",
  data: null,
  error: {
    name: "ErrorName",
    code: "STABLE_ERROR_CODE",
    message: "Safe user-facing details."
  },
  controllerVersion: "..."
}
```

Do not expose:

* Stack traces.
* API keys.
* script properties.
* internal URLs.
* provider credentials.
* raw provider responses.
* spreadsheet implementation details.

---

## Logging and Cost Tracking

Major workflows should create structured log events.

Useful log context includes:

```text
Request ID
Run ID
Idea ID
Script ID
Queue ID
Workflow stage
Controller
Engine
Status
Error name
Error message
Timestamp
```

AI usage should be recorded through the cost service.

Viewing an existing script must not:

* call the AI provider.
* create a cost record.
* increment generation metrics.
* create another script.

---

## Configuration and Secrets

Runtime configuration is resolved through the settings service.

Secrets must not be committed to GitHub.

Do not place API keys directly in:

* `Config.js`
* frontend HTML.
* controller files.
* repositories.
* README examples.
* committed JSON files.

Provider credentials should be resolved through the project secret-management service or Apps Script properties.

When logging errors, remove or mask sensitive values.

---

## Known Issues and Current Limitations

### Approval Queue verification

The Approval Queue workflow is implemented. It requires continued live regression testing with real review records as later production stages are added.

### Queue controller

`App/QueueController.js` now provides queue listing, metrics, approval, rejection and return-for-changes operations through frontend-safe entry points.

### Deployment versioning

A successful `clasp push` does not guarantee that the public deployment is running the newest source. A new deployment version may be required.

### Flat Apps Script namespace

Google Apps Script loads server-side JavaScript into a shared global namespace.

Avoid:

* Duplicate global function names.
* duplicate constants.
* generic helper names at global scope.
* relying on Node.js module imports.
* relying on filesystem folder load order.

Prefer module patterns such as:

```javascript
const FeatureController = (() => {
  function privateHelper_() {}

  function publicOperation() {}

  return {
    publicOperation: publicOperation
  };
})();
```

### Browser caching

The deployed frontend may retain an older version after deployment.

Use a hard refresh when verifying frontend changes.

### Google Sheets schema coupling

Repositories validate worksheet headers. Manual column changes may cause repository errors.

Schema changes should be handled through a controlled migration rather than silently accepting incompatible headers.

---

## Development Rules

All Project Savannah development must follow these rules.

### Source control

1. GitHub `sprint-2` is the canonical source of truth.
2. Inspect the latest branch before proposing code.
3. Pull before starting a change.
4. Do not overwrite newer GitHub code with an older local or Apps Script copy.
5. Keep commits focused.
6. Do not commit secrets.
7. Review `git diff` before committing.

### File delivery

1. Provide complete replacement files.
2. Provide one file at a time.
3. Include the exact file path.
4. Do not provide partial snippets when a full replacement is required.
5. Preserve all existing functionality.
6. Explain the purpose of each replacement.
7. Wait until the file is saved, pushed and tested before moving to the next file.

### Implementation sequence

Every file change follows this sequence:

```text
Inspect GitHub
→ Design change
→ Replace one complete file
→ Save
→ clasp push
→ Run server-side tests
→ Run frontend regression test
→ Review logs and sheets
→ Git status
→ Git diff
→ Git commit
→ GitHub push
→ Confirm canonical branch
```

### Architecture

1. Frontend code handles presentation and interaction.
2. Controllers validate and sanitise requests.
3. Engines orchestrate workflows.
4. Models define canonical data.
5. Repositories own persistence.
6. Services own shared infrastructure.
7. Providers own external API communication.
8. No layer should bypass the layer beneath it without a documented reason.
9. Avoid duplicating business rules.
10. Status transitions must be explicit and testable.

### Quality

Every feature should improve one or more of:

* Content quality.
* automation.
* reliability.
* maintainability.
* scalability.
* observability.
* security.
* operator usability.

---

## Roadmap

### v1.0 — Foundation

Completed foundation:

* Google Sheets database.
* Apps Script backend.
* OpenAI connectivity.
* idea generation.
* logging.
* cost tracking.
* initial dashboard.

### v1.1 — Modular architecture

Completed:

* Modular service structure.
* repositories.
* provider abstraction.
* prompt separation.
* workflow engines.
* controller boundaries.
* setup and validation structure.

### v1.2 — Script workflow

Completed:

* Script prompt library.
* script generation.
* structured script model.
* script validation.
* automatic repair attempts.
* script formatting.
* script persistence.
* script controller.
* source-idea transition to `Script Ready`.
* latest-script retrieval.

### v1.3 — Product frontend and review workflow

Completed:

* Standalone web application.
* design system foundation.
* navigation.
* dashboard workspace.
* ideas workspace.
* scripts workspace.
* automatic script form prefill.
* status-aware idea cards.
* `View script` behaviour.
* prevention of duplicate generation when viewing scripts.

Completed:

* Send saved script for review.
* `Pending Approval` status.
* Approval Queue persistence.
* Approval Queue workspace.
* approve action.
* reject action.
* return-for-changes action.
* review notes.
* queue metrics.
* script and queue status synchronisation.

In progress:

* Approval metrics integration with the dashboard.
* End-to-end live regression coverage.

### Future releases

Planned future capabilities include:

* Script revision history.
* reviewer assignment.
* richer audit history.
* SEO-pack generation.
* titles and descriptions.
* keyword and hashtag generation.
* thumbnail ideation.
* production planning.
* voiceover generation.
* media assembly.
* publication scheduling.
* YouTube integration.
* analytics ingestion.
* performance feedback loops.
* prompt and model experimentation.
* migration from Google Sheets when scale requires a dedicated database.

---

## Definition of Done

A Project Savannah change is complete only when:

* The latest GitHub source was inspected first.
* Existing functionality is preserved.
* The complete replacement file is saved.
* `clasp push` succeeds.
* Relevant Apps Script tests pass.
* Manual frontend regression testing passes.
* No unintended duplicate records are created.
* Logs contain no unexpected errors.
* Cost records are correct.
* `git diff` contains only intended changes.
* The change is committed.
* The commit is pushed to `sprint-2`.
* GitHub contains the tested source.
* Deployment is updated when required.
