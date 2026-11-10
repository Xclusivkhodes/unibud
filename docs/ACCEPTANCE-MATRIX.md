# Acceptance matrix

UI status for every row: not written. Browser e2e: not run. Live provider and YouTube calls: not run.

Search alias: `Gemma Study Companion` resolves, in this document, to Study Companion. No screen implements search yet.

| Destination | Domain behavior in this milestone | Test | Not done |
|---|---|---|---|
| Mission Control | Real session, attempt, task, and streak denominators. No seeded history. | `tests/backend.test.ts` | No screen |
| Study Companion | Stores the learner question and an unavailable status. No fabricated assistant answer. Google blocked. | `tests/backend.test.ts` | No screen; no live model |
| Learning Studio | Owned source, sourced outline, saved explanation | `tests/backend.test.ts` | Upload bytes are validated but not yet a stored file service |
| Reality Lab | Projectile, strong-acid pH, Punnett, bubble sort, sine. Assumptions returned. | `tests/backend.test.ts` plus labs module | No screen or chart |
| Practice and Quiz | Attempts, objective key, idempotent client token | `tests/backend.test.ts` | Question formats beyond single choice |
| Flashcard Studio | Reveal required, SM-2 log, self-rated label, not mastery | `tests/backend.test.ts` | No UI reveal control |
| Learning Twin | Attempt evidence and self-report kept separate. Games ignored. | `tests/backend.test.ts` | No screen |
| Study Planner | Unconfirmed task cannot be completed | `tests/backend.test.ts` | Calendar UI |
| Exam Cram Sprint | Priorities from missing or low recorded accuracy. Insufficient time flagged. No future-question prediction. | `tests/backend.test.ts` | No screen |
| Exam Arena | Interruption does not submit a score | `tests/backend.test.ts` | No timer UI |
| Knowledge Stress Test | Uses the attempt store. Hypothesis needs repeated errors. | radar/attempt tests | Dedicated stress starter is the same attempt API with kind `stress` not separately asserted |
| Resource Discovery | Fixture parser, cache expiry, transcript gate, no quality score | `tests/backend.test.ts` | Live Data API |
| Study Circle | Pending invite, active read, revoke, server ack | `tests/backend.test.ts` | No email delivery |
| GameVerse | Built-in bank score labeled not mastery | `tests/backend.test.ts` | No playable UI |
| Academic Compiler | Pack quotes owned sources with ids | `tests/backend.test.ts` | UB-DEC-01 provisional |
| Memory Studio | Card review log shared with scheduler | review test | No separate memory UI |
| Explainer Studio | Depth and sourced label persisted | journey test | UB-DEC-01 provisional |
| Misconception Radar | Repeated errors only; correction clears hypothesis | journey test | UB-DEC-01 provisional |
| Knowledge Universe | Edge origin and not-verified flag in schema and `addGraphEdge` | schema/API, not a dedicated assertion yet | List UI |
| Reality Lens | Deny image interpretation; text mode is not analysis | `lensDecision` implemented, assertion still owed | No image call |
| Academic Autopilot | Proposal stores conflicts and is not applied until confirm | `confirmAutopilot` implemented, assertion still owed | External calendars unspecified |
| Notifications | Invite and confirmed task insert a deduped row | invite path | Delivery channels unresolved |
| Profile and Settings | Profile revision conflict and AI settings row | register creates settings; profile conflict not separately asserted | Unreceived Part D |

Rows marked "assertion still owed" are implemented functions without a direct test. They are not accepted as done.
