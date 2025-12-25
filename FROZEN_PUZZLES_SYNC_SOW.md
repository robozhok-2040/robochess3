# RoboChess — FROZEN Spec + Plan of Work

## Puzzle counts sync (Lichess + Chess.com) incl. Storm/Rush

**Doc ID:** RC-FROZEN-PUZZLES-001  

**Version:** v0.1  

**Status:** FROZEN (change-controlled)  

**Date:** 2025-12-25  

**Owner:** CTO (RoboChess)  

**Audience:** Engineering, Product, QA  

**Language:** UA



---



## 1. Purpose

This document defines the immutable product goals, rules, and implementation boundaries for importing and displaying puzzle activity counts per student from:

- **Lichess:** Standard Puzzles + Puzzle Storm

- **Chess.com:** Standard Puzzles + Puzzle Rush



The intent is to prevent scope drift and "rule changes mid-flight". Any change to goals/rules must follow the Change Control section.



---



## 2. Definitions

### 2.1 Modes

- **Standard Puzzles (Lichess / Chess.com):** classic tactics puzzles solved one-by-one.

- **Puzzle Storm (Lichess):** time-attack mode, "solve as many as possible"; Storm score is treated as "puzzles solved in Storm".

- **Puzzle Rush (Chess.com):** time-attack mode, "solve as many as possible"; Rush activity is tracked separately from Standard Puzzles.



### 2.2 Metrics windows

- **24h**: rolling window `now - 24 hours … now` (UTC).

- **7d**: rolling window `now - 7 * 24 hours … now` (UTC).



### 2.3 "Run"

- A **run** is one launch/session of Storm/Rush.

- "Runs 24h/7d" are counts of sessions within the window (if platform provides); otherwise derived from monotonic counters (best-effort).



---



## 3. Product Goals (Frozen)

### 3.1 What the coach must see per student

In Coach Dashboard (table + student profile), per platform, show:



#### Lichess

1) **Standard Puzzles solved (count)**:

- `lichess_puzzles_solved_24h`

- `lichess_puzzles_solved_7d`



2) **Puzzle Storm**:

- `lichess_storm_puzzles_solved_24h`

- `lichess_storm_puzzles_solved_7d`

- `lichess_storm_runs_24h` (best-effort; optional in UI if not reliable)

- `lichess_storm_runs_7d` (best-effort; optional in UI if not reliable)



#### Chess.com

3) **Standard Puzzles solved (count)**:

- `chesscom_puzzles_solved_24h`

- `chesscom_puzzles_solved_7d`



4) **Puzzle Rush**:

- `chesscom_rush_runs_24h` (best-effort)

- `chesscom_rush_runs_7d` (best-effort)

- OPTIONAL: `chesscom_rush_best_score_all_time` (context only; not KPI)

- OPTIONAL: `chesscom_rush_best_runs_all_time` / other summary fields if already available



### 3.2 Non-goals (out of scope)

- Puzzle ratings (any platform)

- Puzzle quality metrics (accuracy, time-to-solve, themes)

- "Per puzzle" deep analytics

- Forcing perfect accuracy: best-effort is acceptable where platform limits exist



---



## 4. Immutable System Rules (Engineering Invariants)

1) **UI never calls external platforms directly.** All external fetches happen in backend jobs, persisted in DB.

2) **0 is not the same as missing data.**

   - If metric is truly unknown/unavailable -> store/display `NULL` and show `—`.

   - Never show `0` unless we can prove it is zero.

3) **All time calculations are in UTC** and consistent across services.

4) **Idempotent sync:** running the same job multiple times must not double-count.

5) **Auditability:** each sync writes a snapshot/aggregate record with timestamps and status.

6) **Rate limiting safe:** jobs must be serializable and resilient (backoff / retry).

7) **Frozen semantics:** "24h" and "7d" are rolling windows, not calendar day/week.



---



## 5. Platform Reality & Required Approach

### 5.1 Lichess

- To compute Standard Puzzles 24h/7d with acceptable correctness we require **user-authorized access** to puzzle activity (OAuth/token).

- Puzzle Storm has a dedicated dashboard endpoint; use it to compute Storm 24h/7d totals.



**If a student has Lichess username but no authorization token:**

- We still keep the connection, but:

  - `lichess_puzzles_solved_24h` = NULL

  - `lichess_puzzles_solved_7d` = NULL

  - Storm metrics may still be attempted if endpoint is public for username; if not, set NULL.



### 5.2 Chess.com

- Chess.com public endpoints reliably expose **Puzzle Rush summary counters**, enough for best-effort "runs" deltas.

- Chess.com Standard Puzzles solved 24h/7d is **not guaranteed available** via public API.



**MVP policy for Chess.com Standard Puzzles:**

- If we cannot obtain a reliable monotonic "total solved puzzles" counter or event log via official means:

  - `chesscom_puzzles_solved_24h` = NULL

  - `chesscom_puzzles_solved_7d` = NULL

  - UI shows `—` with tooltip: "Chess.com doesn't expose this via public API."



**Phase 2 policy (allowed solutions):**

- Add a user-side "companion" (browser extension / desktop helper) that reads the user's own dashboard and pushes aggregates to RoboChess.

- Manual import / self-report is allowed only if explicitly approved later (Change Control).

- Server-side scraping behind login is NOT part of this frozen plan by default.



---



## 6. Data Model Requirements (Conceptual)

Implementation must map to existing schema (Prisma/Supabase/DB). If fields/tables already exist, reuse them. If not, add minimal structures.



### 6.1 Required persisted entities

A) **External account connection** per student per platform:

- student_id

- platform enum {lichess, chesscom}

- username

- auth state (connected / token present / revoked)

- last_sync_at

- last_sync_status + error (for debugging)



B) **Aggregates/snapshots** sufficient to compute:

- 24h and 7d rolling counts

- delta-based metrics for Rush runs (when using monotonic attempts counters)



C) **(Optional but recommended) Event store** for Lichess puzzle activity:

- store minimal events (timestamp + success flag + stable id/hash)

- retention: keep at least 35 days, so 7d windows are safe and re-computable



### 6.2 Required API contract to UI

Backend must provide per student:

- Lichess: standard puzzles 24h/7d, storm puzzles 24h/7d (+ optional storm runs)

- Chess.com: standard puzzles 24h/7d (NULL if unavailable), rush runs 24h/7d (+ optional best score)



Plus:

- last sync time + status per platform.



---



## 7. Sync Strategy (Frozen)

### 7.1 Jobs

We implement provider-specific sync modules and a single orchestrator job:



- `syncPuzzlesForStudent(studentId)`

  - subcalls:

    - `syncLichessStandard(studentId)`

    - `syncLichessStorm(studentId)`

    - `syncChesscomStandard(studentId)` (MVP may produce NULL)

    - `syncChesscomRush(studentId)`



- `cronSyncPuzzlesForCoach(coachId)` or `cronSyncPuzzlesAll()` depending on existing architecture.



### 7.2 Cadence (default)

- Lichess: every **6 hours**

- Chess.com: every **24 hours** (more frequent allowed but not required)



### 7.3 Computation rules

- Rolling 24h/7d are derived from:

  - Lichess Standard: event timestamps within windows (preferred)

  - Lichess Storm: dashboard aggregation over days; map to rolling windows as best as provided

  - Chess.com Rush: delta of monotonic "total attempts" snapshots for 24h/7d (best-effort)

  - Chess.com Standard: NULL until reliable official method exists



### 7.4 Error handling

- On user not found / invalid username: mark sync status and keep previous known aggregates (do not overwrite with zero).

- On rate limit: backoff + retry, do not poison data.

- On auth token invalid/revoked: mark "token_required/invalid" and set Standard puzzles metrics to NULL.



---



## 8. UI Display Rules (Frozen)

### 8.1 Coach Dashboard table

We keep UI compact and stable:

- Each student shows four blocks/rows (or one block with lines):

  - Lichess Puzzles: `7d`, `24h`

  - Lichess Storm: `7d`, `24h` (+ optional runs)

  - Chess.com Puzzles: `7d`, `24h` (may be `—`)

  - Chess.com Rush: `7d`, `24h` (runs best-effort)



### 8.2 Null vs zero

- `NULL` -> show `—` (unknown/unavailable)

- `0` -> show `0` (confirmed zero)



### 8.3 Tooltips

- If Chess.com Standard puzzles are NULL:

  - "Chess.com doesn't expose standard puzzle counts via public API. Rush is tracked separately."

- If Lichess Standard puzzles are NULL due to token:

  - "Connect Lichess to enable puzzle counts (24h/7d)."



### 8.4 "Last updated"

Show `last_sync_at` per platform (subtle), and status indicator if stale.



---



## 9. Acceptance Criteria (Frozen)

### 9.1 Lichess Standard Puzzles

- For a student with valid Lichess auth:

  - `lichess_puzzles_solved_24h` and `..._7d` are non-null and change with activity.

- For a student without valid auth:

  - Standard puzzles 24h/7d are NULL (not 0).



### 9.2 Lichess Storm

- Storm 24h/7d metrics are non-null if platform exposes the data for that user.

- If not accessible, must be NULL with a clear sync status.



### 9.3 Chess.com Rush

- Rush runs 24h/7d are produced best-effort via snapshot delta.

- If snapshots are insufficient, metric is NULL (not 0).



### 9.4 Chess.com Standard Puzzles

- MVP: metrics are NULL unless a reliable official method is implemented.

- UI must show `—` and tooltip.



### 9.5 System

- No external API calls from UI.

- Sync is idempotent.

- No double counting.

- Errors do not overwrite valid historical data with zeros.



---



## 10. Plan of Work (Execution Phases)

### Phase 0 — Repo Recon (required first)

Deliverable: a short internal note in PR description / dev log with findings.

Tasks:

- Identify existing Prisma models/tables used for platform connections and stats snapshots.

- Identify current cron endpoints/jobs patterns and where to attach new sync.

- Identify existing UI components that render "puzzles 24h/7d" (if any).

- Confirm where student-platform usernames are stored and how they are validated.



### Phase 1 — Lichess Standard Puzzles (counts)

Deliverable: DB populated with Lichess standard puzzle counts 24h/7d for authorized users.

Tasks:

- Implement/enable Lichess authorization storage (token) in a safe manner (encrypted at rest).

- Implement Lichess puzzle activity ingestion (minimal event fields).

- Implement rolling window aggregation (24h/7d) from events.

- Write snapshots/aggregates and update last_sync_at/status.

- Unit tests for windowing + idempotency.



### Phase 2 — Lichess Puzzle Storm

Deliverable: Storm 24h/7d counts (and optional runs) visible in API.

Tasks:

- Implement Storm dashboard fetch and parse (no need to store raw payload beyond troubleshooting).

- Map to 24h/7d (best-effort based on data granularity).

- Persist aggregates and expose via API.



### Phase 3 — Chess.com Puzzle Rush (runs)

Deliverable: Rush runs 24h/7d via snapshot deltas.

Tasks:

- Implement daily Chess.com stats snapshot fetch.

- Store monotonic counter(s) needed for delta.

- Compute 24h/7d runs as diffs between appropriate snapshots.

- Persist aggregates and expose via API.



### Phase 4 — Chess.com Standard Puzzles (MVP = NULL)

Deliverable: UI shows "—" with tooltip; backend returns NULL.

Tasks:

- Ensure API returns NULL for `chesscom_puzzles_solved_24h/7d`.

- Add UI tooltip and "not available via public API" copy.

- Add tracking/logging so we know how many users are impacted.



### Phase 5 — UI Integration (Coach Dashboard + Student Profile)

Deliverable: stable UI representation with correct null/zero semantics.

Tasks:

- Add four blocks: Lichess Puzzles / Lichess Storm / Chess.com Puzzles / Chess.com Rush.

- Add "Last updated" per platform.

- Add tooltips for NULL cases.

- QA test with: (a) full data, (b) missing token, (c) invalid username, (d) rate limited.



### Phase 6 — Phase 2 Extension (optional, not MVP)

Deliverable: only if explicitly approved via Change Control.

Goal: obtain Chess.com Standard puzzles counts (24h/7d) via user-side companion.

Tasks:

- Design companion protocol (secure push of daily aggregate).

- Build minimal extension PoC.

- Implement backend endpoint to accept aggregates.

- Add "Enable Chess.com puzzle counts" UX flow.



---



## 11. Change Control (Strict)

This spec is FROZEN. Any change requires:

1) A PR that updates this file.

2) A "Change Request" section added at bottom with:

   - what changes

   - why

   - impact on DB/API/UI

   - rollout/migration plan

3) Explicit approval from product owner (CEO/PM) + CTO.



No "silent edits" are allowed.



---



## 12. Change Log

- v0.1 (2025-12-25): Initial frozen scope: puzzle counts only (no ratings), Lichess Standard + Storm, Chess.com Rush + Standard puzzles NULL in MVP.

