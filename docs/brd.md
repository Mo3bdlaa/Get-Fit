# Get Fit — Business Requirements Document (BRD)

**Version:** 0.1 (Discovery output)
**Author:** M. Shaker
**Date:** 23 Aug 2026
**Status:** Draft — for review

---

## 1. Executive Summary

Get Fit is a mobile-first fitness application combining workout logging, AI-assisted
programming, and a coach/team layer. Discovery has established that the full vision
spans three distinct products (consumer tracker, coach SaaS, AI content engine).
This document scopes **v1 to the consumer tracker plus one differentiating AI feature**,
and places the coach and nutrition layers on a staged roadmap.

**v1 hypothesis to be tested:** users will log workouts consistently in an app whose
AI can identify gym equipment from a photo and build programmes constrained to the
equipment the user actually has access to.

**Primary success metric:** Week-4 retention of registered users. Revenue is
explicitly not a v1 metric (v1 is free).

---

## 2. Decisions Locked in Discovery

| # | Decision | Rationale |
|---|---|---|
| D1 | v1 is entirely free; no billing engine | Removes the largest epic; commission/payouts would require KYC and payout rails |
| D2 | Single user account; a user may optionally join a team | Avoids duplicate identity model |
| D3 | Progress photos stored server-side, three visibility modes | See §7 |
| D4 | AI programmes: direct to individual users; require coach approval inside a team | Human-in-the-loop where a coach relationship exists |
| D5 | Coach status granted by manual admin approval | Coaches gain access to sensitive data; gatekeeping is deliberate |
| D6 | Exercise catalogue seeded from a public-domain dataset | See §6 |
| D7 | Platform: PWA (Next.js). Native apps deferred | Single-developer capacity; reuse of existing stack |
| D8 | Nutrition deferred to v2 | Scope control |

---

## 3. Open Decisions (owner: Product)

| # | Decision needed | Blocks | Target date |
|---|---|---|---|
| O1 | Which single community/market to launch into | Marketing, catalogue localisation | Before Sprint 1 |
| O2 | Default UI language (code stays bilingual regardless) | i18n setup | Before Sprint 1 |
| O3 | Minimum age policy and enforcement | Legal, signup flow | Before Sprint 2 |
| O4 | Product name / domain | Branding | Before launch |
| O5 | Whether this project proceeds in parallel with the other product | Everything | Immediately |

---

## 4. Personas

**P1 — Self-directed trainee (primary, v1)**
Trains alone, has access to a specific and often limited set of equipment, wants
structure without paying for a coach. Success = they log three sessions a week.

**P2 — Independent coach (v2)**
Manages 10–30 clients, currently uses WhatsApp and spreadsheets. Wants programme
delivery, client progress visibility, and less admin. Success = they move at least
five clients onto the platform.

**P3 — Team owner (v3)**
Owns a team that multiple coaches operate within. Needs role management and
oversight. Deliberately out of scope until P2 is validated.

---

## 5. Scope — MoSCoW

### Must (v1)
- Email/password auth, profile (height, gender, goals)
- Measurements log (weight, body measurements) with trend chart
- Exercise catalogue, searchable and filterable by equipment and muscle
- User equipment profile ("what I have access to")
- Workout logging: one row per set (weight, reps, RPE, notes)
- Programme entity: self-created or AI-generated, executable session by session
- AI equipment scan: photo of a machine returns structured guidance
- Offline logging with sync
- Bilingual scaffolding (en/ar) with RTL support
- Per-user AI usage quota

### Should (v2)
- Teams, invite codes, coach role
- Coach-authored programmes and approval workflow
- Progress photos with visibility controls
- Coach view of trainee data
- Coach application and admin approval flow

### Could (v3)
- Nutrition: food catalogue, meal plans, food logging
- AI progress-photo comparison
- Billing: individual subscription
- Seat packs for coaches

### Won't (this cycle)
- Coach commission and payouts (requires KYC, payment rails, tax handling)
- Gym B2B contracts
- Native app store releases
- Social feed, challenges, gamification

---

## 6. Exercise Catalogue Strategy

**Seed source:** `free-exercise-db` (yuhonas) — 800+ exercises in structured JSON,
public domain, includes an `equipment` field and per-exercise images. Public domain
status means no attribution or copyleft obligation on a closed-source product.

**Explicitly rejected:** ExerciseDB (AscendAPI) — licensed AGPL-3.0. Network-service
use would trigger source disclosure obligations, incompatible with a closed product.

**Optional supplement:** MIT-licensed video datasets exist (~317 exercises with
demo videos) if video is required later.

**Pipeline:**
1. Import seed → normalise into internal schema (never query the source shape directly)
2. Add Arabic names and cues manually (highest-value 150 exercises first)
3. Coach-submitted exercises enter a moderation queue; approved entries join the
   global catalogue, unapproved remain private to that coach
4. AI may propose new catalogue entries but never writes to the catalogue directly

---

## 7. Progress Photos — Requirements and Constraints

Three visibility modes on a single `photo_visibility` field:

| Mode | Behaviour |
|---|---|
| `private` (**default**) | No one but the owner. Sharing is a deliberate per-photo action |
| `team_coaches` | All coaches in the user's team may view |
| `gender_filtered` | Only coaches whose declared gender matches the user's preference |

**Critical constraint on `gender_filtered`:** the filter operates on self-declared
coach profile data. There is no verification mechanism. UI copy must state this
plainly (e.g. "based on coaches' stated profile information") so users do not infer
a guarantee that does not exist. Implementing this silently would create a false
sense of safety and is the highest-severity design risk in the product.

**Additional requirements:**
- Encryption at rest; signed, short-lived URLs — never public object URLs
- Full deletion on user request, including from backups within a stated window
- Access log: every photo view recorded with viewer identity and timestamp
- Consent captured per recipient, not as a blanket signup checkbox
- Photos excluded from any model training or third-party retention; the AI vendor
  processing terms must be disclosed in the privacy policy

---

## 8. AI Requirements

### 8.1 Equipment Scan
- Input: photo. Output: structured JSON (machine name, primary/secondary muscles,
  setup, common form errors, suggested exercises from the internal catalogue)
- Must map to catalogue IDs, not free text
- Defined failure behaviour: on low confidence, ask the user to confirm from a
  shortlist rather than guessing
- Optional action: "add this to my equipment"

### 8.2 Programme Generation
- Constrained to the user's equipment profile and catalogue IDs — the model selects,
  it does not invent exercises
- `program.source` = `ai` | `coach` | `self`
- `program.status` = `draft` → `pending_approval` → `active` → `archived`
- Individual users bypass `pending_approval`; team members do not

### 8.3 Safety Guardrails (Must, not Should)
- Any user input indicating pain, injury, or a medical condition halts generation
  and directs the user to a qualified professional — the system does not attempt
  to work around an injury
- No diagnostic claims, no body-composition estimates from photos, no numeric
  body-fat outputs
- No calorie targets below established safe floors (deferred with nutrition, but
  the rule is recorded now)
- Persistent, visible disclaimer that the product is not medical advice

### 8.4 Cost Control
- Per-user monthly quota on vision calls (proposed: 20), enforced server-side
- Aggressive caching: identical images and repeated catalogue lookups do not re-call
- Cost-per-active-user dashboard from day one. Free tier without a quota is an
  uncapped liability

---

## 9. Data Model (core)

```
users ──< measurements
      ──< workout_logs (one row per set)
      ──< media (progress photos)
      ──< user_equipment
      ──< team_members >── teams
      ──< programs

exercises ──< program_exercises >── programs
exercises ──< workout_logs

teams ──< invites
coach_applications
photo_access_grants
audit_log
```

**Non-negotiable fields from day one:**
- `workout_logs`: one row per set. Retrofitting this later means rewriting history
- Every user-generated record: `owner_id` plus `visibility`
- `programs`: `source`, `status`, `created_by`, `approved_by`, `approved_at`
- Soft delete with `deleted_at` everywhere; hard delete only via the erasure job

**Data ownership on team exit (must be answered before build):**
- Logs and measurements remain owned by the trainee
- Coach loses read access immediately on membership end
- Programmes authored by the coach: proposal — trainee retains a read-only snapshot,
  coach retains the template

---

## 10. Permission Matrix

| Resource | Trainee (self) | Coach (own team) | Team Owner | Admin |
|---|---|---|---|---|
| Own profile | CRUD | R | R | R |
| Trainee workout logs | CRUD | R | – | R (support only, logged) |
| Trainee measurements | CRUD | R | – | R (logged) |
| Progress photos | CRUD | Per §7 | Never by default | Never |
| Programmes (assigned) | R, execute | CRUD | R | R |
| Team membership | Leave | – | CRUD | CRUD |
| Catalogue | R | R + submit | R | CRUD |
| Coach applications | Submit | – | – | Approve/Reject |

Enforcement lives in a single server-side authorisation layer. Per-query filtering
in route handlers is prohibited — it is how data leaks happen.

---

## 11. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR1 | Full workout logging works offline; syncs on reconnect with conflict resolution (last-write-wins per set is acceptable) |
| NFR2 | Client-side image compression before upload (target < 500 KB) |
| NFR3 | Logging a set: ≤ 2 taps, usable one-handed, large touch targets |
| NFR4 | Session survives phone lock mid-workout without data loss |
| NFR5 | Equipment scan returns in < 8s, with progress indication |
| NFR6 | All strings externalised; RTL layout verified per screen |
| NFR7 | Audit log for every access to another user's data |
| NFR8 | Data export (JSON) and account deletion self-service |

---

## 12. RAID Log

### Risks
| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| R1 | **Founder capacity split across two solo part-time products** — highest-probability cause of failure | High | Sequence the two, or kill/pause one. Owner decision, not a technical fix |
| R2 | Gender-filtered photo access implies verification that does not exist | High | Explicit UI copy; private-by-default; consider removing the mode entirely |
| R3 | Uncapped AI cost on a free tier | High | Hard quota, caching, cost dashboard (§8.4) |
| R4 | Sensitive personal data (body photos) with no compliance function | High | Minimise collection, encrypt, retention policy, DPA with AI vendor |
| R5 | Injury attributed to an AI-generated programme | Med | Guardrails §8.3, coach approval in teams, disclaimers, no injury workarounds |
| R6 | Scope creep back toward the full three-product vision | Med | This MoSCoW is the contract; changes go through change control |
| R7 | Bilingual + global launch with no marketing capacity | Med | Pick one community (O1) |
| R8 | Catalogue quality degrades from coach submissions | Low | Moderation queue |

### Assumptions
- A1: Users will log workouts without a coach pushing them (unvalidated — this is the core bet)
- A2: Equipment scanning is a strong enough hook to drive first use
- A3: Public-domain catalogue quality is sufficient without licensed content

### Issues
- I1: No named legal/privacy reviewer for a product handling body imagery
- I2: Product name undecided

### Dependencies
- D1: AI vendor availability, pricing, and data-processing terms
- D2: Public-domain dataset remains available (mitigate: vendor the data into the repo)

---

## 13. Release Plan

**Realistic capacity assumption: one solo part-time developer ≈ one thin vertical
slice per month.** The plan below is sized to that, not to ambition.

| Release | Content | Exit criteria |
|---|---|---|
| **R0 — Walking skeleton** | Auth, one exercise, log one set, see it on a chart, deployed to production | It works end to end for one real user (you) |
| **R1 — Usable tracker** | Full catalogue, equipment profile, programmes (self-authored), measurements, offline sync | You train with it for four weeks without switching to notes |
| **R2 — The hook** | AI equipment scan, AI programme generation with guardrails and quota | 10 external users; measure scan usage and week-2 retention |
| **R3 — Coach layer** | Teams, invites, coach applications, approval workflow, coach visibility, progress photos | 3 real coaches with real clients |
| **R4 — Nutrition** | Food catalogue, logging, meal plans | Only if R2 retention justifies it |

**Gate between R2 and R3:** if week-4 retention is below target, do not build the
coach layer. Fix retention or stop.

---

## 14. Ways of Working

**Definition of Ready** — a story enters a sprint only with:
acceptance criteria in Given/When/Then; UI states defined (empty, loading, error,
offline); for AI stories, a defined failure behaviour and cost estimate; for data
stories, the visibility/ownership rule stated.

**Definition of Done** — merged; deployed to production; works offline where
applicable; strings externalised in both languages; authorisation enforced in the
central layer; audit log written where another user's data is touched; manually
verified on a real phone.

**Change control** — anything outside §5 Must goes to the backlog, not the sprint.
The MoSCoW is renegotiated at release boundaries only.

---

## 15. Immediate Next Actions

1. Answer O5 — whether this runs in parallel with the other product (blocks all else)
2. Answer O1 and O2 — launch community and default language
3. Build R0 (walking skeleton) — target four weeks
4. Draft privacy policy and retention rules before any photo feature is written
5. Run the cost model: expected scans/user/month × unit cost × target user count

---

*Document ends. Version 0.1 — expect revision after R0.*
