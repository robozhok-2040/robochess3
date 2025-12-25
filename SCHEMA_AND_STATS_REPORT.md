# Schema & Stats Implementation Report

## 1. Database Schema: Exact Fields & Unique Indexes

### `platform_connections`
**Fields:**
- `id` (String, UUID, Primary Key, auto-generated)
- `user_id` (String, UUID, Foreign Key → profiles.id)
- `platform` (String)
- `platform_username` (String)
- `platform_user_id` (String?, nullable)
- `last_synced_at` (DateTime?, nullable, Timestamptz)

**Unique Indexes:**
- `@@unique([user_id, platform])` - Ensures one connection per user per platform

---

### `player_stats_v2`
**Fields:**
- `id` (String, UUID, Primary Key, auto-generated)
- `student_id` (String, UUID, Foreign Key → profiles.id)
- `platform` (String) - Comment: 'lichess' or 'chesscom'
- `rapid_24h` (Int?, nullable, default: 0)
- `rapid_7d` (Int?, nullable, default: 0)
- `blitz_24h` (Int?, nullable, default: 0)
- `blitz_7d` (Int?, nullable, default: 0)
- `computed_at` (DateTime, default: now(), Timestamptz)

**Unique Indexes:**
- `@@unique([student_id, platform], name: "student_id_platform")` - Ensures one stats record per student per platform

**Regular Indexes:**
- `@@index([student_id])` - For fast lookups by student

---

### `stats_snapshots`
**Fields:**
- `id` (String, UUID, Primary Key, auto-generated)
- `user_id` (String, UUID, Foreign Key → profiles.id)
- `captured_at` (DateTime, default: now(), Timestamptz)
- `source` (String?, nullable)

**RAPID fields:**
- `rapid_rating` (Int?, nullable, default: 0)
- `rapid_24h` (Int?, nullable, default: 0)
- `rapid_7d` (Int?, nullable, default: 0)
- `rapid_total` (Int?, nullable, default: 0)

**BLITZ fields:**
- `blitz_rating` (Int?, nullable, default: 0)
- `blitz_24h` (Int?, nullable, default: 0)
- `blitz_7d` (Int?, nullable, default: 0)
- `blitz_total` (Int?, nullable, default: 0)

**PUZZLE fields:**
- `puzzle_rating` (Int?, nullable, default: 0)
- `puzzle_24h` (Int?, nullable, default: 0)
- `puzzle_7d` (Int?, nullable, default: 0)
- `puzzle_total` (Int?, nullable, default: 0)

**Unique Indexes:**
- None (snapshots are historical, multiple records allowed per user)

**Regular Indexes:**
- `@@index([user_id])` - For fast lookups by user

---

### `profiles`
**Fields:**
- `id` (String, UUID, Primary Key)
- `email` (String?, nullable)
- `full_name` (String?, nullable)
- `username` (String?, nullable)
- `role` (String?, nullable, default: "student")
- `avatar_url` (String?, nullable)
- `xp` (Int?, nullable, default: 0)
- `level` (Int?, nullable, default: 1)
- `added_by_coach_id` (String?, nullable, UUID)

**Relations:**
- `platform_connections` (one-to-many)
- `stats_snapshots` (one-to-many)
- `player_stats_v2` (one-to-many)
- `student_puzzle_attempts` (one-to-many)

**Unique Indexes:**
- None (no unique constraints on fields)

---

## 2. Current API Implementations

### GET `/api/coach/students`

**Location:** `src/app/api/coach/students/route.ts`

**Current Behavior:**
1. Fetches all students with role="student"
2. Includes `platform_connections` and latest `stats_snapshots` (take: 1, ordered by `captured_at` desc)
3. For students with Lichess or Chess.com connections, fetches v2 stats from `player_stats_v2`:
   - Queries `player_stats_v2` filtered by `student_id` and `platform`
   - Orders by `computed_at` desc to get latest
   - Stores in nested map: `Map<studentId, Map<platform, stat>>`

**Stats Source Logic:**
- **For Lichess/Chess.com (`isV2Platform` = true):**
  - If v2 stats exist: uses `player_stats_v2.rapid_24h`, `rapid_7d`, `blitz_24h`, `blitz_7d`
  - If v2 stats missing: returns `null` (not 0) for all game counts
  - Stats source marked as "v2" or "none"

- **For other platforms:**
  - Uses `stats_snapshots[0]` (latest snapshot)
  - Reads `rapid_24h`, `rapid_7d`, `blitz_24h`, `blitz_7d` from snapshot
  - Defaults to 0 if snapshot missing
  - Stats source marked as "legacy" or "none"

**Output Fields:**
- `stats.rapidGames24h` (number | null)
- `stats.rapidGames7d` (number | null)
- `stats.blitzGames24h` (number | null)
- `stats.blitzGames7d` (number | null)

---

### GET `/api/cron/update-stats-v2`

**Location:** `src/app/api/cron/update-stats-v2/route.ts`

**Current Behavior:**
1. Queries students with role="student" that have Lichess OR Chess.com connections
2. Builds eligible items: each student-platform combination (a student with both platforms appears twice)
3. Sorts by `lastActive` (last_synced_at or latest snapshot captured_at) desc, nulls last
4. Processes items sequentially with 1s delay between items

**For each item:**
- **Lichess platform:**
  - Calls `fetchLichessGamesCount(username, 'rapid', since24hMs, since7dMs)`
  - Calls `fetchLichessGamesCount(username, 'blitz', since24hMs, since7dMs)` (1s delay between)
  - Maps results to: `{rapid_24h, rapid_7d, blitz_24h, blitz_7d}`

- **Chess.com platform:**
  - Calls `fetchChesscomGamesCount(username, since24hMs, since7dMs)`
  - Returns `{rapid: {games24h, games7d}, blitz: {games24h, games7d}}`
  - Maps to: `{rapid_24h, rapid_7d, blitz_24h, blitz_7d}`

5. Stores stats using `storeStatsV2(student.id, platform, stats)`:
   - Upserts into `player_stats_v2` table
   - Uses unique constraint on `[student_id, platform]`
   - Updates `computed_at` to now()

6. **Writes snapshot history:**
   - Creates new `stats_snapshots` record
   - Sets `user_id` = student.id
   - Sets `captured_at` = now()
   - Sets `source` = `cron:v2:${platform}` (e.g., "cron:v2:lichess" or "cron:v2:chesscom")
   - Sets `rapid_24h`, `rapid_7d`, `blitz_24h`, `blitz_7d` from computed stats
   - Sets all rating/puzzle fields to `null` (explicitly, though schema has defaults of 0)

---

## 3. Where Stats Are Currently Read From

### `rapid_24h` / `rapid_7d` / `blitz_24h` / `blitz_7d`

**Primary Source (v2):** `player_stats_v2` table
- Columns: `rapid_24h`, `rapid_7d`, `blitz_24h`, `blitz_7d`
- Used for: Lichess and Chess.com students when v2 stats exist
- Read via: `/api/coach/students` route queries `player_stats_v2` filtered by `student_id` and `platform`

**Fallback Source (legacy):** `stats_snapshots` table
- Columns: `rapid_24h`, `rapid_7d`, `blitz_24h`, `blitz_7d`
- Used for: Other platforms (not Lichess/Chess.com), OR when v2 stats missing
- Read via: Latest snapshot (`stats_snapshots[0]` ordered by `captured_at` desc)

---

## 4. Why Chess.com is "Legacy" and What Needs Change

### Current State (After Recent Changes):
**Chess.com is NO LONGER legacy** - it's been updated to use v2 stats system.

**Previous State (Before Changes):**
- Chess.com was treated as "legacy" because `/api/coach/students` only checked for v2 stats for Lichess
- Chess.com students fell through to the legacy path, reading from `stats_snapshots`
- The cron job `/api/cron/update-stats-v2` only processed Lichess students

**Current State (After Implementation):**
- `/api/cron/update-stats-v2` now processes both Lichess AND Chess.com students
- `/api/coach/students` now checks for v2 stats for BOTH Lichess and Chess.com
- Chess.com students use `player_stats_v2` table (same as Lichess)

**What Was Changed:**
1. ✅ Cron route now queries students with `platform IN ('lichess', 'chesscom')`
2. ✅ Cron route processes Chess.com using `fetchChesscomGamesCount`
3. ✅ Cron route stores Chess.com stats to `player_stats_v2` with `platform='chesscom'`
4. ✅ Cron route writes snapshots with `source='cron:v2:chesscom'`
5. ✅ Coach students API now fetches v2 stats for Chess.com students
6. ✅ Coach students API treats Chess.com same as Lichess (returns null if v2 missing, not 0)

**Nothing to delete/replace** - the implementation is complete. Chess.com now uses the v2 system alongside Lichess.

---

## 5. Column Name Confirmation

### `player_stats_v2` table:
- ✅ `rapid_24h` (Int?)
- ✅ `rapid_7d` (Int?)
- ✅ `blitz_24h` (Int?)
- ✅ `blitz_7d` (Int?)
- ✅ `student_id` (String, UUID)
- ✅ `platform` (String) - values: 'lichess' or 'chesscom'
- ✅ `computed_at` (DateTime)

### `stats_snapshots` table:
- ✅ `rapid_24h` (Int?, default: 0)
- ✅ `rapid_7d` (Int?, default: 0)
- ✅ `blitz_24h` (Int?, default: 0)
- ✅ `blitz_7d` (Int?, default: 0)
- ✅ `user_id` (String, UUID) - Note: different name than `player_stats_v2.student_id`
- ✅ `source` (String?) - stores values like "cron:v2:lichess" or "cron:v2:chesscom"
- ✅ `captured_at` (DateTime, default: now())

**Important Note:** 
- `player_stats_v2` uses `student_id` 
- `stats_snapshots` uses `user_id`
- Both refer to the same `profiles.id` value, just different column names

