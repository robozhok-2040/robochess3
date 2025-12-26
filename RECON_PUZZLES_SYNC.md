# Phase 0 — Repo Recon Report: Puzzle Sync Implementation

**Date:** 2025-01-XX  
**Purpose:** Map existing codebase structure for implementing puzzle sync (RC-FROZEN-PUZZLES-001)

---

## 1. Prisma / DB Schema

### Schema File Location
- **Path:** `prisma/schema.prisma`

### Relevant Models

#### a) Students/Users/Profiles

**Model:** `profiles` (schema: `public`)
- **Location:** `prisma/schema.prisma` lines 467-483
- **Fields:**
  - `id` String @id @db.Uuid
  - `email` String?
  - `full_name` String?
  - `username` String?
  - `role` String? @default("student")
  - `avatar_url` String?
  - `xp` Int? @default(0)
  - `level` Int? @default(1)
  - `added_by_coach_id` String? @db.Uuid
- **Relations:**
  - `platform_connections` (one-to-many)
  - `stats_snapshots` (one-to-many)
  - `student_puzzle_attempts` (one-to-many)
  - `player_stats_v2` (one-to-many)

#### b) External Platform Connections

**Model:** `platform_connections` (schema: `public`)
- **Location:** `prisma/schema.prisma` lines 453-464
- **Fields:**
  - `id` String @id @db.Uuid
  - `user_id` String @db.Uuid (FK to profiles.id)
  - `platform` String (stores 'lichess' or 'chesscom')
  - `platform_username` String
  - `platform_user_id` String?
  - `last_synced_at` DateTime? @db.Timestamptz(6)
- **Constraints:**
  - `@@unique([user_id, platform])` - one connection per student per platform
- **Relations:**
  - `profiles` (many-to-one via user_id)

**Note:** No token/auth field currently exists in `platform_connections`. For Lichess OAuth tokens, we'll need to add a field (see Config/Security section).

#### c) Stats Snapshots/Aggregates

**Model:** `stats_snapshots` (schema: `public`)
- **Location:** `prisma/schema.prisma` lines 499-526
- **Fields:**
  - `id` String @id @db.Uuid
  - `user_id` String @db.Uuid (FK to profiles.id)
  - `captured_at` DateTime @default(now()) @db.Timestamptz(6)
  - `source` String? (e.g., "cron:v2:lichess")
  - **Rapid:** `rapid_rating`, `rapid_24h`, `rapid_7d`, `rapid_total` (all Int?)
  - **Blitz:** `blitz_rating`, `blitz_24h`, `blitz_7d`, `blitz_total` (all Int?)
  - **Puzzles:** `puzzle_rating`, `puzzle_24h`, `puzzle_7d`, `puzzle_total` (all Int?)
- **Relations:**
  - `profiles` (many-to-one via user_id)
- **Indexes:**
  - `@@index([user_id])`

**Model:** `player_stats_v2` (schema: `public`)
- **Location:** `prisma/schema.prisma` lines 529-547
- **Fields:**
  - `id` String @id @db.Uuid
  - `student_id` String @db.Uuid (FK to profiles.id)
  - `platform` String ('lichess' or 'chesscom')
  - `rapid_24h` Int? @default(0)
  - `rapid_7d` Int? @default(0)
  - `blitz_24h` Int? @default(0)
  - `blitz_7d` Int? @default(0)
  - `computed_at` DateTime @default(now()) @db.Timestamptz(6)
  - `last_update_ok` Boolean?
  - `last_update_error_code` String? @db.Text
  - `last_update_error_message` String? @db.Text
  - `last_update_attempt_at` DateTime? @db.Timestamptz(6)
- **Constraints:**
  - `@@unique([student_id, platform], name: "student_id_platform")`
- **Indexes:**
  - `@@index([student_id])`
- **Relations:**
  - `profiles` (many-to-one via student_id)

**Note:** `player_stats_v2` does NOT currently have puzzle fields. We'll need to add puzzle count fields (24h/7d for standard puzzles, storm, rush).

**Model:** `student_puzzle_attempts` (schema: `public`)
- **Location:** `prisma/schema.prisma` lines 551-567
- **Purpose:** Tracks individual puzzle attempts within RoboChess system (NOT external platform puzzles)
- **Fields:**
  - `id` String @id @db.Uuid
  - `user_id` String @db.Uuid (FK to profiles.id)
  - `puzzle_id` String @db.Uuid (FK to chess_puzzles.id)
  - `result` String
  - `is_correct` Boolean?
  - `time_spent_seconds` Int?
  - `broken_on_move` Int?
  - `session_id` String? @db.Uuid
  - `attempt_date` DateTime? @default(now()) @db.Timestamptz(6)
- **Note:** This is for internal puzzle attempts, NOT for tracking Lichess/Chess.com puzzle activity.

---

## 2. Existing Cron/Jobs Infrastructure

### Cron Endpoints

#### `/api/cron/update-stats-v2`
- **Path:** `src/app/api/cron/update-stats-v2/route.ts`
- **Handler:** `export async function GET(request: NextRequest)`
- **Purpose:** Syncs game counts (rapid/blitz 24h/7d) for Lichess and Chess.com students
- **Query params:** `limit`, `offset`, `studentId`, `platform`
- **Process:** 
  - Loads `platform_connections` where platform IN ('lichess', 'chesscom')
  - Filters to students with valid usernames
  - Calls `computeFromLichess()` or `computeFromChessCom()` from `src/lib/stats/gamesActivityV2.ts`
  - Upserts into `player_stats_v2`
  - Creates snapshot records in `stats_snapshots` (non-fatal)
  - Updates `platform_connections.last_synced_at` on success

#### `/api/cron/update-stats` (Legacy)
- **Path:** `src/app/api/cron/update-stats/route.ts`
- **Purpose:** Legacy stats sync (still configured in Vercel cron)
- **Note:** Still referenced in `vercel.json` but appears to be legacy

### Cron Triggering

**Vercel Cron (vercel.json):**
- **File:** `vercel.json` lines 2-7
- **Configuration:**
  ```json
  {
    "crons": [
      {
        "path": "/api/cron/update-stats",
        "schedule": "0 0 * * *"
      }
    ]
  }
  ```
- **Note:** Currently points to legacy `/api/cron/update-stats`, not `/api/cron/update-stats-v2`

**Internal Scheduler:**
- **File:** `src/lib/cron/scheduler.ts`
- **Function:** `startScheduler()` (exported)
- **Interval:** 6 hours (`SCHEDULE_INTERVAL_MS = 6 * 60 * 60 * 1000`)
- **Initial delay:** 5 seconds
- **Calls:** `/api/cron/update-stats-v2?limit=100&offset=0`
- **Trigger:** Started via `/api/_boot` endpoint (`src/app/api/_boot/route.ts`)
- **Guard:** Uses `globalThis.__rcSchedulerStarted` to prevent duplicate starts

### Retry/Backoff Utilities

**Rate Limiter:**
- **File:** `src/lib/rateLimiter.ts`
- **Export:** `scheduleLichessRequest<T>(fn: () => Promise<T>)`
- **Implementation:** Uses Bottleneck library
- **Config:** 
  - `minTime: 1200ms` (~1 request per 1.2 seconds)
  - `maxConcurrent: 1` (serialized requests)
- **Usage:** Wraps Lichess API calls to prevent rate limiting

**Note:** No generic retry/backoff utility found. Retry logic is currently implemented inline in UI components (e.g., `src/app/(coach)/coach/page.tsx` line 365+ has `fetchWithRetry` with exponential backoff).

---

## 3. Dashboard API Layer

### Coach Dashboard Endpoint

**Endpoint:** `GET /api/coach/students`
- **Path:** `src/app/api/coach/students/route.ts`
- **Handler:** `export async function GET(request: NextRequest)`
- **Query params:** `debug` (optional, returns extra fields)

### Response Shape

**Type definition:** `ApiStudent` (in `src/app/(coach)/coach/page.tsx` lines 12-39)

```typescript
interface ApiStudent {
  id: string;
  nickname: string;
  stats: {
    rapidRating: number | null;
    blitzRating: number | null;
    puzzleRating: number | null;
    rapidGames24h: number | null;
    rapidGames7d: number | null;
    blitzGames24h: number | null;
    blitzGames7d: number | null;
    puzzles3d: number; // Maps from DB column puzzles_24h
    puzzles7d: number;
    puzzle_total: number;
  };
  platform?: string;
  platform_username?: string;
  avatar_url?: string;
  last_active?: string | null;
  statsSource?: "v2" | "none";
  statsComputedAt?: string | null;
  lastSyncedAt?: string | null;
  statsIsStale?: boolean;
  statsUpdateOk?: boolean | null;
  statsUpdateErrorCode?: string | null;
  statsUpdateAttemptAt?: string | null;
}
```

### Puzzle Fields Current Implementation

**Location:** `src/app/api/coach/students/route.ts` lines 168-171

```typescript
// PUZZLES (always from legacy snapshots for now)
puzzles3d: latestStats?.puzzle_24h ?? 0,
puzzles7d: latestStats?.puzzle_7d ?? 0,
puzzle_total: latestStats?.puzzle_total ?? 0,
```

**Source:** 
- Reads from `stats_snapshots` table (most recent snapshot per student)
- Fields: `puzzle_24h`, `puzzle_7d`, `puzzle_total`
- Currently defaults to `0` if missing (should be `null` per frozen spec)

**Note:** The API currently does NOT differentiate between Lichess puzzles, Lichess Storm, Chess.com puzzles, or Chess.com Rush. All puzzle counts come from a single `puzzle_24h`/`puzzle_7d` field.

---

## 4. UI Locations

### Coach Dashboard Component

**File:** `src/app/(coach)/coach/page.tsx`
- **Component:** `CoachDashboardPage` (default export, line 148)
- **Props:** None (fetches data internally)

### Puzzle Field Usage

**Type definitions (lines 12-60):**
- `ApiStudent.stats.puzzles3d` (maps from `puzzle_24h`)
- `ApiStudent.stats.puzzles7d`
- `ApiStudent.stats.puzzle_total`
- `ApiStudent.stats.puzzleRating`

**Internal Student type (lines 42-60):**
- `puzzleDelta3d: number | null` (uses `puzzles3d` from API)
- `puzzleDelta7d: number | null`
- Also includes `puzzleRating` from API

**Table sorting (line 72-76):**
- Sort keys include: `"puzzleDelta3d"`, `"puzzleDelta7d"`, `"puzzleRating"`

**Table columns:**
- Search for puzzle column headers in table JSX (likely around lines 1400-1700)
- Columns display: `puzzleDelta3d`, `puzzleDelta7d`, `puzzleRating`

**Note:** Need to search table JSX to find exact column rendering locations for puzzles. The UI expects `puzzles3d`/`puzzles7d` but these map to `puzzle_24h`/`puzzle_7d` in the database.

---

## 5. Config/Security

### Environment Variables

**Current usage:**
- `LICHESS_TOKEN` - Used in:
  - `src/app/api/cron/update-stats-v2/route.ts` (line 181)
  - `src/lib/stats/gamesActivityV2.ts` (line 158)
  - `src/app/api/debug/lichess-export/route.ts` (line 140)
- `NEXT_PUBLIC_APP_URL` - Used in scheduler for base URL
- `VERCEL_URL` - Used in scheduler for Vercel deployments
- `DEBUG_API_KEY` - Used in debug endpoint auth
- `DATABASE_URL` - Prisma datasource (standard)

**Storage location:**
- Environment variables (`.env.local`, `.env`, Vercel env vars)
- No encryption utilities found in codebase
- No dedicated secrets management service identified

### Token Storage Recommendation

**For Lichess OAuth tokens:**

**Option 1: Add field to `platform_connections`**
- **Pros:** Keeps auth data with connection record
- **Cons:** Requires encryption at rest (no existing encryption utility found)
- **Implementation:** Add `lichess_oauth_token_encrypted` String? field, implement encryption/decryption helpers

**Option 2: New `platform_tokens` table**
- **Pros:** Separates sensitive data, easier to audit
- **Cons:** More complex joins, still needs encryption
- **Fields:** `id`, `platform_connection_id` (FK), `token_encrypted`, `expires_at`, `created_at`, `updated_at`

**Option 3: External secrets service (future)**
- Use Vercel env vars per-student (not scalable)
- Use dedicated secrets management (e.g., HashiCorp Vault, AWS Secrets Manager)

**Recommendation for MVP:** Add encrypted field to `platform_connections` table, implement simple encryption helper using Node.js `crypto` module (AES-256-GCM) with key from `LICHESS_ENCRYPTION_KEY` env var.

---

## 6. Next Implementation Hooks

### Phase 1: Lichess Standard Puzzles

**Database changes:**
- Add `lichess_oauth_token_encrypted` String? field to `platform_connections` model
- Create encryption helper in `src/lib/security/tokenEncryption.ts`

**Sync module:**
- Create `src/lib/stats/puzzlesActivity.ts` (similar to `gamesActivityV2.ts`)
- Export `computeLichessStandardPuzzles()` function
- Use Lichess puzzle activity API endpoint (requires OAuth token)

**Event store (optional but recommended):**
- Create `lichess_puzzle_events` table or reuse/extend existing event log structure
- Fields: `id`, `user_id`, `platform_connection_id`, `puzzle_id`, `solved_at`, `event_hash` (for idempotency)

**Cron integration:**
- Add puzzle sync call in `src/app/api/cron/update-stats-v2/route.ts` OR create separate `/api/cron/update-puzzles-v2/route.ts`
- Store aggregates in new `player_puzzle_stats_v2` table OR extend `player_stats_v2` with puzzle fields

**API response:**
- Extend `src/app/api/coach/students/route.ts` to include `lichess_puzzles_solved_24h`, `lichess_puzzles_solved_7d`
- Read from new puzzle stats table

### Phase 2: Lichess Puzzle Storm

**Sync module:**
- Add `computeLichessStormPuzzles()` to `src/lib/stats/puzzlesActivity.ts`
- Fetch from Lichess Storm dashboard endpoint
- Map to 24h/7d rolling windows

**Database:**
- Add fields to puzzle stats table: `lichess_storm_puzzles_24h`, `lichess_storm_puzzles_7d`, `lichess_storm_runs_24h`, `lichess_storm_runs_7d`

**API response:**
- Extend `/api/coach/students` response with storm fields

### Phase 3: Chess.com Puzzle Rush

**Sync module:**
- Add `computeChesscomRushRuns()` to `src/lib/stats/puzzlesActivity.ts`
- Fetch Chess.com stats endpoint (public, no auth needed)
- Use snapshot delta approach (store monotonic counters, compute 24h/7d diffs)

**Database:**
- Add fields: `chesscom_rush_runs_24h`, `chesscom_rush_runs_7d`, `chesscom_rush_best_score_all_time`

**API response:**
- Extend `/api/coach/students` response with rush fields

### Phase 4: Chess.com Standard Puzzles (MVP = NULL)

**Implementation:**
- Ensure API returns `null` for `chesscom_puzzles_solved_24h/7d`
- Add UI tooltip handling in `src/app/(coach)/coach/page.tsx`
- Add logging to track how many students are affected

### Phase 5: UI Integration

**Files to modify:**
- `src/app/(coach)/coach/page.tsx`:
  - Extend `ApiStudent` interface with new puzzle fields (Lichess standard, Lichess storm, Chess.com rush)
  - Update table column rendering to show four puzzle blocks
  - Add tooltips for NULL cases
  - Update sorting logic if needed

**Recommended table structure:**
- Replace single "Puzzles (3d)" and "Puzzles (7d)" columns with:
  - Lichess Puzzles: 24h / 7d
  - Lichess Storm: 24h / 7d (optional runs)
  - Chess.com Puzzles: 24h / 7d (may be "—")
  - Chess.com Rush: 24h / 7d (runs)

---

## Summary

**Key findings:**
1. Existing `stats_snapshots` has `puzzle_24h`/`puzzle_7d` but these are generic (not platform-specific)
2. `player_stats_v2` table exists for game counts but has no puzzle fields yet
3. Cron infrastructure exists (`update-stats-v2`) and can be extended or mirrored for puzzles
4. Rate limiting utility exists (`src/lib/rateLimiter.ts`) for Lichess API calls
5. No encryption utilities found - will need to implement for OAuth token storage
6. Dashboard API (`/api/coach/students`) already includes puzzle fields but from legacy snapshots
7. UI expects `puzzles3d`/`puzzles7d` but these currently map to generic `puzzle_24h`/`puzzle_7d`

**Recommendations:**
- Create new `player_puzzle_stats_v2` table (separate from game stats) OR extend `player_stats_v2` with puzzle fields
- Implement encryption helper for Lichess OAuth tokens
- Create separate cron endpoint `/api/cron/update-puzzles-v2` or extend existing one
- Use existing `stats_snapshots` for audit history (with `source='cron:v2:puzzles:lichess'` etc.)

