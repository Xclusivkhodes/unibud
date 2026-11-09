# Traceability

## UI history

Stephen first asked to preview visual design before UI implementation, so early work stayed on the domain library. Founder approval at 01:08 Africa/Accra accepted the revised glass direction and the selected owl rasters. That approval is a visual direction, not production release and not acceptance of unfinished modules. This commit still has no application routes or screens. Reference files, not an interface: `docs/design/approved-glass-v2.jpg`, `public/brand/unibud-primary-logo-reference.png` (1028×442), `public/brand/unibud-navy-owl-reference.png` (198×233). Rasters are opaque crops, not finalized vectors. The concept JPEG must not be served as the application background or as a screenshot.

## UB-DEC-01

Provisional, reversible contracts for six underdefined modules. Rationale: low-dependency fits for the learning cycle that can be replaced when a fuller founder specification arrives. They do not narrow the required scope.

- Compiler: learner-owned sources become a study pack whose blocks carry source ids. Unsupported claims are not marked sourced.
- Explainer: saved explanation stores depth, body, and sourced/generated label.
- Stress Test: retrieval can be started from real missed attempts. No psychometric adaptivity claim. A stress attempt uses the same attempt store.
- Misconception Radar: a hypothesis requires repeated wrong answers on the same question and links those attempts. One wrong answer stays a single error. Correction changes status. This is not a diagnosis.
- Knowledge Universe: edges are `learner` or `inferred`, with `academic_verification = not_verified`.
- Reality Lens: image mode does not fabricate an interpretation. Missing eligibility denies. Text mode is explicitly not image analysis.

## UB-DEC-02

Primary name in documents and search metadata is Study Companion. `Gemma Study Companion` is retained as a search alias string in `docs/ACCEPTANCE-MATRIX.md`. Runtime provider and model are whatever the router selects, and Google is currently blocked. No UI label is rendered because UI is on hold.

## UB-DEC-03

Server SQLite persistence and file-backed device records are both implemented and tested. `synced` is set only after `applyAck`. Conflicts keep both bodies. Browser service-worker reload remains outstanding required scope, not an optional roadmap item.

## UB-RES-02

Google live use is blocked. Unknown age, under-18-directed access, sensitive or unknown sensitivity, and unpaid or unknown billing add explicit denial reasons. YouTube quality scores and aggregate playlist durations are not computed. `search.list` quota constants cite UB-RES-02 Y1 because a direct fetch of the quota page timed out in this run; they are not a live project limit. API cache expiry is 30 days and does not delete learner bookmarks. Caption download is unavailable without video-edit OAuth.

## UB-CRIT-02

Acceptance rows in `docs/ACCEPTANCE-MATRIX.md` are proposed gates plus the checks this backend actually runs. They are not a claim that the full product or UI is accepted.

## Unreceived specification

Master text stopped during AI error handling. v4 Part D stopped during settings. Those missing sentences are unresolved criteria, not invented requirements.
