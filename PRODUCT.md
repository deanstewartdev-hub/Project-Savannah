# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dean is currently the sole operator and approver of Project Savannah, producing and publishing content for one YouTube channel, Savannah Atlas. The product is not permanently constrained to one user or one channel — this reflects current operating reality, not a fixed architectural constraint. Whether and when multi-user or multi-channel support is built remains undecided.

## Product Purpose

Project Savannah is an internal AI-assisted YouTube Shorts production platform. It automates as much of the production workflow as practical — Idea → Script → Script Approval → SEO → Production → Video Review → YouTube Publishing → Analytics — while retaining human approval for important quality, publishing, destructive, security-sensitive, and meaningful paid-provider actions.

A normal successful workflow should not require manual Google Sheets or database repair.

## Positioning

Savannah's positioning is the integrated, traceable, end-to-end production workflow — idea generation, script generation, validation and repair, human approval, SEO generation, video production, video review, YouTube publishing, cost tracking, and analytics and performance feedback — not any one specific renderer or provider.

## Operating Context

- Workflow: Idea → Script → Script Approval → SEO → Production → Video Review → YouTube Publishing → Analytics.
- Google Sheets and Google Drive are part of Savannah's persistence and storage architecture.
- Project Savannah uses a separate Node.js + FFmpeg media worker for media-heavy production processing.

## Capabilities and Constraints

- Integrates third-party AI and media providers and Google Workspace and YouTube APIs to generate, produce, and publish content. Specific providers are implementation detail and may change.
- Major production-provider replacements should be validated against the incumbent workflow before the proven fallback is removed.
- Undecided: whether and when multi-user or multi-channel support is built.

## Brand Commitments

- Channel: Savannah Atlas.
- AI-voice disclosure must be kept in YouTube descriptions.
- Voice and tone apply to viewer-facing content only — scripts, narration, titles, descriptions, and editorial decisions. They do not govern the application UI's design system, typography, colors, or layout, which are separate concerns.
- Savannah Atlas uses a flexible documentary-travel voice built around curiosity, credibility, and cinematic storytelling:
  - Knowledgeable and informative without sounding academic or robotic.
  - Curiosity-driven: strong hooks, surprising details, and unanswered questions that sustain attention.
  - Cinematic and adventurous — places, history, geography, cultures, and unusual facts feel worth discovering.
  - Conversational and approachable, written for a broad audience.
  - Confident but accurate; never presents uncertain claims as established fact.
  - Concise and well-paced for short-form video, with minimal filler or repetition.
  - Natural rather than obviously AI-generated; avoids generic AI phrasing, repetitive hook formulas, and excessive superlatives.
  - Respectful when discussing countries, cultures, history, and people.
  - Evidence-aware, especially for factual, historical, or unusual claims.
  - Engaging without knowingly misleading or resorting to false clickbait.
  - Energy adapts by subject: calmer and atmospheric for scenic or nature content, clearer and more educational for history, geography, or explainers, and faster and more energetic for strange facts or high-retention Shorts. These are variations of one Savannah Atlas voice, not separate brands.

## Evidence on Hand

- DESIGN_SYSTEM.md and COMPONENT_LIBRARY.md remain the authorities for the existing application visual system; this file does not restate or override them.
- No testimonials, customer evidence, benchmarks, pricing, or licensing claims exist in the repository; none should be fabricated in future work.

## Product Principles

1. Automate the production workflow end-to-end, but retain human approval for important quality, publishing, destructive, security-sensitive, and meaningful paid-provider actions.
2. The integrated end-to-end workflow is the product; specific providers and rendering implementations are details that can change without changing the product.
3. Major production-provider replacements should be validated against the incumbent workflow before the proven fallback is removed.
4. Treat repository evidence as authoritative for current implementation state; mark genuinely unconfirmed decisions as undecided rather than inventing them.
5. Viewer-facing brand voice for Savannah Atlas content and application UI design are governed separately.

## Accessibility & Inclusion

WCAG 2.2 AA is the accessibility target for Project Savannah's application UI, even though it is an internal, single-operator tool today. At minimum, preserve: keyboard-accessible navigation and controls; visible focus states; sufficient color contrast; readable typography and spacing; labels for controls and form fields; sensible heading structure; touch and click targets that are not unnecessarily small; interfaces that do not rely on color alone to communicate status; and clear error, warning, approval, and destructive-action states.
