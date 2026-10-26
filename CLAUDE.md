# Project Savannah — Claude Code Instructions

## Project purpose

Project Savannah is an AI-assisted YouTube Shorts production platform.

The production workflow is:

Idea
→ Script
→ Approval
→ SEO
→ Production
→ Video Review
→ YouTube Publishing
→ Analytics

GitHub and the repository are the source of truth.

---

## Start every development session by verifying state

Before proposing or making changes:

1. Run `git branch --show-current`.
2. Run `git status`.
3. Run `git log -1 --oneline`.
4. Inspect the current repository documentation.
5. Confirm the canonical branch from the repository itself.
6. Never assume current project state from a previous AI session or memory.

Branch model, verified from Git and GitHub on 26 October 2026 (re-verify; this will drift):

- GitHub's default branch is `main`, but it is stale: it holds only the merge of PR #1 (2 August 2026) and contains neither this file nor any v1.4 work.
- `sprint-3` (last commit 9 August 2026) was the canonical branch when these instructions were first written. `main` is 0 commits ahead of and 28 behind it, so the first step of the documented merge order is a fast-forward of `main` to `sprint-3` (`RELEASE_READINESS.md` section 3).
- All current work is a stack of open pull requests, merged bottom-up by the owner. The integration branch is `integration/v1.4-callback-inbox-and-duration-preflight`; other PRs are stacked on it or on each other. Branch from the tip of the PR you are extending, base a new PR on its parent in the stack, and do not push, merge or deploy without the owner's approval.
- The sibling folders `Project-Savannah-*` are git worktrees, each belonging to one PR in the stack. `git worktree list` shows them.

The AI tooling work was originally isolated on `chore/ai-development-stack` at baseline commit `974515c` ("Fix callback acknowledgement and stop mislabeling successful renders as failed"). That is history, not a working baseline.

If repository state has changed since this file was written, current Git and current repository documentation take precedence.

---

## Required project documentation

Before substantial Savannah development, inspect the relevant sections of:

- `README.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `APPROVALS_REQUIRED.md`
- `SAVANNAH_AUDIT_AND_PLAN.md`
- `ARCHITECTURE.md`
- `COMPONENT_LIBRARY.md`

When present, also inspect:

- `AI_DEVELOPMENT_WORKFLOW.md`
- `AI_SETUP_CHECKLIST.md`
- `AI_HANDOFF.md`

Do not create competing documentation when an existing authoritative document should be updated instead.

---

## Current production direction

Project Savannah v1.4 Professional Output replaces the legacy Creatomate-first rendering architecture with the Savannah media worker.

Current architecture:

Google Apps Script
→ render job submission
→ Savannah media worker
→ ElevenLabs continuous narration
→ OpenAI Whisper alignment
→ Pexels video footage
→ GPT image fallback
→ FFmpeg assembly
→ animated captions
→ music ducking
→ loudness normalization
→ ffprobe quality inspection
→ Google Cloud Storage
→ callback to Apps Script
→ human review
→ YouTube

The worker runs on Google Cloud Run (a dispatcher service plus a render job). Railway served as a temporary bridge while a Google Cloud Run routing issue was investigated, and was retired on 24 October 2026 (`CHANGELOG.md`; `RELEASE_READINESS.md` section 9).

Do not assume the hosting situation remains unchanged. Check the latest repository documentation first.

---

## Critical v1.4 rule

Do not remove:

- `Production/Creatomate_Service.js`
- `CreatomateProviderAdapter`

until the success condition recorded in `ROADMAP.md` and `APPROVALS_REQUIRED.md` is satisfied.

A real production Savannah script must successfully complete the new production pipeline and be compared side-by-side with the legacy Creatomate result before the fallback renderer is removed.

---

## Production investigation at the tooling baseline (historical, August 2026)

At that baseline:

- the media worker had successfully produced a genuine 1080×1920 render;
- Railway was being used as the active temporary host;
- Apps Script deployment access had been changed so server-to-server callbacks could reach `doPost`;
- callback acknowledgement logic had been repaired;
- successful renders were no longer incorrectly reported as failed when callback delivery failed.

The migration to Cloud Run was then functionally validated end to end (`CHANGELOG.md`, 11 August 2026); the remaining v1.4 work (production cut-over, first real render and private upload) is tracked in `RELEASE_READINESS.md`.

Always inspect the latest `ROADMAP.md`, `CHANGELOG.md` and `RELEASE_READINESS.md` before continuing production debugging.

---

## Architecture boundaries

Maintain the existing layered architecture.

```text
Frontend
→ Controller
→ Service / Workflow
→ Model / Repository
→ Persistence or External Provider
```
