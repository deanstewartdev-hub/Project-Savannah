# Project Savannah — Technical Audit and Streamlined Plan

Prepared 3 August 2026. This document is intended to replace the existing handover
as the working plan, and to sit in the repository alongside `README.md` and `ROADMAP.md`.

Decisions already taken by Dean and assumed throughout:

- Tooling budget: £20–40 per month, excluding OpenAI API usage.
- Visual approach: hybrid — real stock footage where it fits, AI stills as fallback.
- Rendering: self-hosted FFmpeg worker on Google Cloud Run.
- This session: audit and plan first, code afterwards.

---

## 1. The headline finding

The roadmap names the immediate blocker as Creatomate's trial resolution clamp. That
is accurate as a fact and misleading as a priority. Resolution is a symptom, not the
disease.

The disease is the shape of the output. Every Savannah Short is four still images,
each held for roughly eight to eleven seconds, joined by hard cuts, with a five-word
caption pinned over each one. Rendering that at 1080×1920 instead of 270×480 produces
a sharper slideshow. It does not produce a video that anyone watches to the end.

Shorts that retain attention cut every one and a half to three seconds and almost
always contain real motion. Savannah currently cuts three times in forty-five seconds
and contains no motion at all. Paying for Creatomate's Essential plan at $41 a month
(roughly £32) would tick the
`fullHdVertical` checkbox in `RenderQuality_Service.js` and change nothing a viewer
would notice.

There is a second reason this matters beyond retention. YouTube's inauthentic content
policy, which has been enforced considerably more aggressively through 2026, targets
exactly this pattern: template-driven output produced at scale with no meaningful
variation between videos and no visible creator perspective. The policy is assessed at
channel level rather than video level, and the penalties escalate from limited ad
earnings to monetisation suspension to termination. Savannah as currently designed is a
machine for producing precisely the artefact the policy describes. That is worth
confronting now, while the channel has five uploads, rather than at eighty.

None of this is an argument against the project. The orchestration layer, the approval
workflow, the cost tracking, the duplicate guards and the analytics foundation are
genuinely well built and represent most of the work. The argument is that the last mile
— the part that determines whether anyone watches — is currently the weakest link, and
that the plan should be reordered to fix it before spending money to preserve it.

---

## 2. Audit findings

### 2.1 Apps Script is the wrong runtime for media work, and the code already shows it

`CreatomateService.createRender()` performs the entire production pipeline inside a
single synchronous Apps Script execution: build the scene plan, make four text-to-speech
calls, measure four MP3 files, refit the plan, make four `gpt-image-2` calls at
1024×1536, assemble the payload, then submit the render.

Apps Script executions are capped at six minutes. Image generation at that size
routinely takes tens of seconds per image. Four images plus four narration calls sits
at or past the ceiling on a normal run and well past it on a slow one.

This is not a hypothetical. The per-scene progress persistence, the resume-from-scene
logic, the pause and cancel states and much of the five-minute worker in Phase 3 exist
to work around that ceiling. A substantial amount of the "Production Hardening" work is
complexity purchased to compensate for a runtime choice rather than to solve a real
production problem. Moving media assembly to a worker does not just unblock rendering —
it retires a meaningful slice of Phase 3.

### 2.2 Narration is generated per scene, which is why it sounds synthetic

`VoiceoverService.prepareSceneAudio` makes four separate calls to `gpt-4o-mini-tts`,
one per scene, and Creatomate concatenates the results. Every scene boundary is a hard
prosodic reset: pitch returns to baseline, sentence-to-sentence flow is broken, and the
join is audible.

`prepareContinuousAudio` already exists in the same file and generates a single
continuous take. It is not called anywhere in the render path. The better-sounding
implementation was written and then bypassed.

### 2.3 MP3 duration is measured by assuming a constant bitrate

`mp3DurationSeconds_` locates the first MPEG frame header, reads that frame's bitrate,
and divides the remaining byte length by it. This is only correct for constant-bitrate
files. If the encoder ever returns variable bitrate, or the file carries a trailing tag,
the measurement drifts.

Every downstream timing decision depends on this one number: `fitToSlotDurations`
validates against it, scene durations are derived from it, and `RenderQuality_Service`
gates on the ratio between planned and actual duration. It is a load-bearing
approximation. `ffprobe` returns the exact value and becomes available for free the
moment a worker exists.

### 2.4 The quality gate inspects the request, not the video

`RenderQualityService.evaluate` reads `job.requestPayload.modifications`. When it sets
`narrationComplete: true`, what it has actually verified is that a non-empty URL string
was present in the render request. If that URL returned a 404 and the video rendered in
silence, the gate passes.

Similarly `scenesComplete` confirms four image URLs were requested, `captionsComplete`
confirms four caption strings were supplied, and `visualVariety` confirms the four URLs
differ from one another. The only checks that touch reality are duration, width and
height, and those are taken from Creatomate's own response rather than from the file.

Every genuinely valuable check still listed as outstanding in Phase 3 — silence
detection, black and frozen frame detection, loudness targets, clipping — requires
probing the finished media. That is `ffprobe` and a handful of FFmpeg filters, and it
is not achievable from inside Apps Script at all.

### 2.5 Four scenes is hard-coded in at least five places

`SLOT_COUNT = 4` in `ScenePlan_Service.js`; a literal `for (index = 0; index < 4; index++)`
in `Creatomate_Service.js`; explicit slot validation in both `prepareSceneAudio` and
`prepareSceneVisuals`; a fixed `1..4` loop in `RenderQuality_Service.js`; and the
Creatomate template's `Image-1` through `Image-4` element names.

The template shape is the real constraint and it has propagated into the domain logic.
Any move toward a faster cut rate requires changing all of it. Removing Creatomate is
also what removes this constraint, because an FFmpeg worker has no fixed template.

### 2.6 The pre-flight duration gate can reject good scripts

`ScenePlanService.create` estimates duration at a flat 2.0 words per second and throws
if the result falls outside thirty to sixty seconds — before any audio has been
generated. `fitToSlotDurations` then re-measures and re-validates against the real
figure.

Delivery rate varies with voice, speed setting and punctuation. A script that estimates
at 61 seconds and actually delivers in 54 is currently rejected outright. The estimate
should produce a warning; only measured audio should gate.

### 2.7 Asset delivery over Drive download links is fragile and over-permissive

Every narration MP3 and every scene image is written to Drive, set to
`ANYONE_WITH_LINK`, and handed to Creatomate as
`https://drive.google.com/uc?export=download&id=...`. That endpoint is rate-limited,
can return an HTML interstitial instead of the file, and Google has been progressively
restricting it. It also means every production asset the project has ever generated is
publicly readable to anyone holding the URL.

A Cloud Storage bucket with time-limited signed URLs is both more reliable and
considerably tighter, and it is nearly free at this volume.

### 2.8 Documentation is internally contradictory

`README.md` states `sprint-2` is canonical, deployment version 61, last verified
2 August. `ROADMAP.md` states `sprint-3` is canonical, deployment version 78, updated
3 August. `Config.js` declares `VERSION: "1.0.0"` while every service header says v1.3.
`COMPONENT_LIBRARY.md` is zero bytes. `ARCHITECTURE.md` has an unclosed code fence that
swallows the directory listing beneath it.

The repository could not be reached from this session — `https://github.com/deanstewartdev-hub/Project-Savannah.git`
returns 403, so it is private and no credential is available here. All findings above
come from the local working copy at
`C:\Users\dean9\Documents\GitHub\Project-Savannah`, which may or may not match
`sprint-3` on GitHub. Confirming that is the first task of the next session.

---

## 3. What to cut

Streamlining means removing things, so this section is specific about what goes.

**Creatomate goes entirely.** It is the source of the resolution blocker, the four-scene
constraint and a recurring subscription, and it makes audio mastering and real media
inspection impossible. Do not upgrade the plan. Do not migrate to Shotstack or
JSON2Video either — they impose the same template-shaped constraints for the same money.

**The Apps Script render queue shrinks to job submission and polling.** Per-scene resume,
pause, cancel and five-level priority exist to survive a six-minute ceiling that the
worker does not have. Keep a job record, a status, and a webhook callback. The queue,
retry and concurrency concerns move inside the worker where they belong.

**Phases 5, 6 and 7 come out of the roadmap.** Intelligent automation, multi-channel and
enterprise are all at zero percent, and their presence is what drags the headline number
to "51% complete" — a figure that is both demoralising and meaningless. Multi-channel
support on a Google Sheets backend, for a channel that has not yet published a video it
is proud of, is premature by a wide margin. Park them in a separate `FUTURE.md`.

**The seven-phase framing goes with them,** replaced by three concrete releases described
in section 6.

**The `render_scale` machinery goes.** `PREMIUM_RENDER_SCALE` and the associated
comments exist solely to work around Creatomate trial behaviour.

---

## 4. Proposed architecture

```text
┌─────────────────────────────────────────────────────────┐
│ Google Apps Script  —  orchestration, UI, Sheets        │
│ Ideas · Scripts · Approval · SEO · Publishing · Analytics│
└───────────────┬─────────────────────────▲───────────────┘
                │ POST /jobs              │ webhook callback
                │ (script, beats,         │ (video URL, probe
                │  branding, voice)       │  results, cost)
                ▼                         │
┌─────────────────────────────────────────┴───────────────┐
│ Cloud Run: savannah-media-worker  (Node 22 + FFmpeg)    │
│                                                          │
│  1. Narration    ElevenLabs — ONE continuous take        │
│  2. Alignment    Whisper word-level timestamps           │
│                  → caption timings + beat boundaries     │
│  3. Visuals      Pexels video search per beat            │
│                  → gpt-image-2 still + Ken Burns fallback│
│  4. Assemble     FFmpeg: 8–14 beats, crossfades,         │
│                  word-pop captions, music bed with       │
│                  sidechain ducking, loudnorm to −14 LUFS,│
│                  1080×1920 H.264                         │
│  5. Probe        ffprobe: duration, resolution, silence, │
│                  black frames, integrated loudness       │
│  6. Deliver      → GCS → signed URL → callback           │
└──────────────────────────────────────────────────────────┘
```

The provider abstraction the handover already proposed stays, and is what makes this
safe to build incrementally:

```text
VideoProcessingProvider
├── CloudRunFFmpegProvider   ← new, becomes the default
└── CreatomateProvider       ← retained until the first good render, then deleted
```

Four things in this design are what turn "slideshow" into "professional", and each is
worth naming explicitly.

**One continuous narration take.** The voice is generated once for the whole script, so
prosody flows across the entire piece. Scene boundaries are then derived *from* the
audio rather than imposed on it.

**Word-level alignment.** Whisper returns per-word timestamps for the narration audio.
Those timestamps drive both the caption animation — the word-pop style every performing
Short uses — and the visual cut points, so cuts land on the beat of the speech instead
of on arbitrary sentence groupings. This single mechanism replaces the entire estimate-
then-refit dance in `ScenePlan_Service.js`.

**Real footage with motion, mixed with animated stills.** Pexels supplies genuine 4K
vertical clips of real places, free and without attribution requirements. Where no
suitable clip exists, the existing `gpt-image-2` still is used with a Ken Burns push and
a subtle grade. The prompt in `VisualAsset_Service.js` is already written to "seed an
image-to-video model", so the intent was there.

**Mastered audio.** A music bed under the narration, sidechain-compressed so it ducks
automatically when the voice speaks, with the final mix normalised to −14 LUFS — the
level YouTube targets. This is the difference between audio that sounds amateur and
audio that sounds finished, and it costs nothing but an FFmpeg filter chain.

---

## 5. Platforms to sign up for

Direct answer to the question asked.

### Required

**Google Cloud Platform — billing account enabled.** Free tier covers the usage, but
Cloud Run and Cloud Storage require a billing account with a card on file. Use the same
Google account that owns the Apps Script project and the Savannah spreadsheet.
Estimated cost at thirty Shorts per month: effectively zero, with detail in section 7.

**ElevenLabs — Creator plan, $22/month.** This is the single biggest quality gain
available and the reason for the "professional audio" part of the brief. Commercial
usage rights begin at the $5 Starter tier, and Starter's ~30 minutes would technically
cover thirty 45-second Shorts at 22.5 minutes — but that leaves no headroom for
regenerating a take you do not like, which you will do often. Creator's ~100 minutes is
the practical choice. API access is included from Starter upward.

**Pexels API key.** Free, issued instantly, no card. The license permits commercial use,
does not require attribution, and explicitly allows modification. Two restrictions
matter here: do not portray identifiable people in an offensive light, and do not imply
endorsement by any person or brand appearing in the footage.

### Recommended but optional

**Pixabay API key.** Free. Worth having purely as a second stock source so that a beat
with no Pexels match still gets real footage rather than falling through to a still.

### Explicitly not needed

**Creatomate.** Do not upgrade. The trial ends and nothing is lost.

**Shotstack, JSON2Video, Plainly and similar.** Same constraints, same recurring cost,
no advantage over the worker.

**Runway, Kling, Veo, Sora and other generative video APIs.** Skip for now. At roughly
$1.60 to $4.80 per Short — roughly £1.25 to £3.75, based on 32 seconds of generated
motion at published per-second API rates — they would consume most of the budget, and the hybrid approach
should be evaluated on its own before deciding whether generated motion adds enough to
justify that. This is the right thing to revisit at v1.6 with real retention data.

**A music subscription.** Not needed. Rather than wiring up a music API, curate ten to
twenty tracks once from the YouTube Audio Library, confirm each is clear, and store them
in the bucket for the worker to select from. One afternoon of work, no recurring cost,
and no risk of an API serving a track that triggers a Content ID claim.

### Already needed, still outstanding

**YouTube Analytics API.** Enable it in the linked Cloud project and add the read-only
analytics scope. No cost. This is the Phase 4 item already flagged in
`APPROVALS_REQUIRED.md` and it becomes straightforward once a billing-enabled Cloud
project exists for the worker anyway.

**The `script.scriptapp` OAuth scope.** Still required for the background trigger, still
a one-time reauthorisation, still free.

---

## 6. Revised release plan

### v1.4 — Professional Output

The goal is one Short that is genuinely good, produced end to end without manual
intervention. Not one Short that passes a checkbox.

Repository first: reconcile the README and roadmap onto `sprint-3`, fix the version
string in `Config.js`, repair the `ARCHITECTURE.md` code fence, add `CHANGELOG.md`,
mark `apps-script` and `docs` as archived, and move Phases 5 to 7 into `FUTURE.md`.

Then build the worker: a Node service on Cloud Run with FFmpeg, a GCS bucket for assets
and outputs, ElevenLabs continuous narration, Whisper word alignment, Pexels search with
AI-still fallback, the FFmpeg assembly chain, ffprobe inspection, and a signed-URL
callback into Apps Script.

Then adapt Apps Script: introduce `VideoProcessingProvider`, add `CloudRunFFmpegProvider`
alongside the existing `CreatomateProvider`, replace the four hard-coded slot loops with
a beat list of variable length, rewrite `RenderQualityService` to consume real probe
results rather than the request payload, downgrade the pre-flight duration estimate from
a throw to a warning, and move asset storage from public Drive links to signed URLs.

Success condition: a new idea travels from generation to a verified private YouTube
upload with no manual database repair, and the finished video is one you would show
someone without apologising for it.

### v1.5 — Reliability and Templates

Authorise the background worker and daily analytics triggers. Add worker-side retries,
concurrency limits and a dead-letter state. Add the thumbnail workflow, which is a
straightforward extension once the worker exists. Add template versioning so a job
records which look it was produced under, and build two or three genuinely distinct
looks rather than one — this also happens to be the most direct mitigation against the
inauthentic content risk in section 1.

### v1.6 — Analytics and Feedback

YouTube Analytics API ingestion for watch time and retention. Cost per video and cost
per thousand views joined against the existing `Costs` sheet. Retention curves compared
across template versions, hook patterns and cut rates. Only at this point is there
enough evidence to decide whether generated motion clips are worth their per-video cost.

---

## 7. Cost model

At an assumed thirty Shorts per month:

| Item | Cost | Notes |
| --- | --- | --- |
| Cloud Run | £0 | ~9,000 vCPU-seconds against a 240,000 always-free allowance; roughly 27× headroom |
| Cloud Storage | under £1 | A few GB of assets and outputs |
| ElevenLabs Creator | $22 (~£17) | ~22.5 min used of ~100 min included |
| Pexels / Pixabay | £0 | Free API tiers |
| Music | £0 | Curated once from the YouTube Audio Library |
| Creatomate | £0 | Removed |
| OpenAI | usage-based | Scripts, SEO, Whisper alignment, and fallback stills only |

Total recurring, excluding OpenAI: approximately £18 per month, against a £20–40 budget.
The Cloud Run figure assumes roughly 150 seconds of two-vCPU encoding per video; even at
three times that estimate the free tier is not exhausted.

The saving against the alternative is real: Creatomate Essential plus ElevenLabs would
have been $63 a month, roughly £49, for a worse result and no path to the automated quality
checks.

---

## 8. Risks worth naming

**The worker adds operational surface.** A container that must be built, deployed and
occasionally patched is genuinely more to own than an API key. The mitigation is that it
is a single stateless service with one endpoint, deployed by one command, and that the
alternative is paying monthly for something that cannot do the job.

**Stock footage is not exclusive.** Other channels use the same Pexels clips. Meaningful
narration, distinct pacing and varied templates are what make the result yours; footage
choice alone is not. This is the same point as the inauthentic content risk and has the
same answer.

**Whisper alignment costs an extra API call per video** and adds a failure mode. Falling
back to the existing sentence-grouping logic when alignment fails keeps this contained.

**The GitHub repository could not be verified from this session.** Everything above
describes the local working copy. If `sprint-3` on GitHub has diverged, some findings
may be stale. Verifying this is the first task of the next session.

---

## 9. Immediate next steps

1. Confirm the local working copy matches `sprint-3` on GitHub, and resolve the README
   and roadmap contradictions.
2. Create the Google Cloud billing account and an ElevenLabs Creator subscription;
   generate a Pexels API key.
3. Build and deploy `savannah-media-worker` to Cloud Run, and prove it end to end on the
   existing test script before touching Apps Script.
4. Compare that output side by side against the current Creatomate render, and only then
   commit to removing Creatomate.
5. Introduce `VideoProcessingProvider` in Apps Script and switch the default provider.
6. Run the full regression on one new Short and upload it privately.

Steps 2 and 4 need Dean. Everything else can proceed without him.
