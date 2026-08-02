# Project Savannah Architecture

Project Savannah is an AI-powered YouTube Shorts automation platform built with a modular, production-ready architecture.

## Engineering Principles

### 1. Single Responsibility

Each file should have one clear purpose.

Examples:

- `ScriptEngine.js` orchestrates script generation.
- `ScriptsRepository.js` reads and writes script records.
- `ScriptPromptLibrary.js` builds script prompts.
- `OpenAI.js` communicates with OpenAI.

### 2. Layered Architecture

Each feature should follow this flow:

```text
User Action
→ Engine
→ Service
→ AI Provider
→ Repository
→ Google Sheets


AI          AI services, providers, schemas, prompt libraries
Dashboard   Dashboard UI, widgets, styles, refresh logic
Ideas       Idea generation workflow and repository
Scripts     Script generation workflow and repository
Services    Shared services such as logging, costs, settings, secrets
Setup       Sheet setup, migrations, validation
Utils       General helper utilities