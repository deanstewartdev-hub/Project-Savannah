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

At the time these instructions were introduced, the canonical development branch was:

`sprint-3`

The AI tooling work was isolated on:

`chore/ai-development-stack`

Baseline commit:

`974515c`

Commit message:

`Fix callback acknowledgement and stop mislabeling successful renders as failed`

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

The worker was hosted on Railway as a temporary bridge while a Google Cloud Run routing issue was being investigated.

Do not assume the hosting situation remains unchanged. Check the latest repository documentation first.

---

## Critical v1.4 rule

Do not remove:

- `Production/Creatomate_Service.js`
- `CreatomateProviderAdapter`

until the success condition recorded in `ROADMAP.md` and `APPROVALS_REQUIRED.md` is satisfied.

A real production Savannah script must successfully complete the new production pipeline and be compared side-by-side with the legacy Creatomate result before the fallback renderer is removed.

---

## Current production investigation at tooling baseline

At baseline:

- the media worker had successfully produced a genuine 1080×1920 render;
- Railway was being used as the active temporary host;
- Apps Script deployment access had been changed so server-to-server callbacks could reach `doPost`;
- callback acknowledgement logic had been repaired;
- successful renders were no longer incorrectly reported as failed when callback delivery failed.

The production investigation was still active.

Always inspect the latest `ROADMAP.md` and `CHANGELOG.md` before continuing production debugging.

---

## Architecture boundaries

Maintain the existing layered architecture.

```text
Frontend
→ Controller
→ Service / Workflow
→ Model / Repository
→ Persistence or External Provider