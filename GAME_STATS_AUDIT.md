# Game Stats Calculation Audit: Lichess vs Chess.com

## Summary

**CRITICAL FINDING:** The `update-stats` route (cron job) uses **TWO DIFFERENT APPROACHES**:
- **Lichess**: Uses "Snapshot Delta" (❌ Dumb - resets to 0 on cold start)
- **Chess.com**: NOT IMPLEMENTED in cron route (only in `player-lookup` route which uses "History Filter" ✅ Smart)

---

## 1. LICHESS - Current Implementation in `update-stats` route

### Location: `src/app/api/cron/update-stats/route.ts` (lines 31-49)

### Approach: **SNAPSHOT DELTA** (❌ Dumb)

```typescript
// --- RAPID CALCULATION ---
const currRapid = data.perfs?.rapid?.games ?? 0;  // LIFETIME TOTAL from Lichess API
const prevRapidTotal = latestSnapshot?.rapid_total ?? 0;

// Cold Start: If history is missing/zero, delta is 0 (Calibration run).
let rapidDelta = 0;
if (prevRapidTotal > 0) {
    rapidDelta = Math.max(0, currRapid - prevRapidTotal);
}

// Saves: rapid_24h = rapidDelta (only games since last snapshot)
```

### How it works:
1. ✅ Fetches current LIFETIME total from `data.perfs.rapid.games`
2. ✅ Reads previous LIFETIME total from last snapshot (`rapid_total`)
3. ❌ Calculates delta: `current_total - previous_total`
4. ❌ **PROBLEM**: If `prevRapidTotal` is 0 (cold start), `rapidDelta = 0` (even if player has 1000 games!)
5. ❌ **PROBLEM**: Only counts games BETWEEN snapshots, not games in last 24h/7d

### Issues:
- ❌ **Cold Start Problem**: First run always shows 0 (even if player has many games)
- ❌ **Not Time-Based**: Doesn't actually filter by 24h/7d windows - only counts games since last snapshot
- ❌ **Reset on Missing Snapshot**: If snapshot is deleted/missing, stats reset to 0

---

## 2. CHESS.COM - Current Implementation

### Location: `src/app/api/player-lookup/route.ts` (lines 198-234)

### Approach: **HISTORY FILTER** (✅ Smart)

```typescript
async function countChessComGames(
  username: string,
  timeClass: "rapid" | "blitz",
  since24h: number,
  since7d: number,
  debug: { errors: string[]; archiveFetchStatuses: number[] }
): Promise<{ games24h: number; games7d: number }> {
  let games24h = 0;
  let games7d = 0;
  
  // 1. Fetch list of available archives
  const archivesResponse = await fetchWithTimeout(
    `https://api.chess.com/pub/player/${username}/games/archives`,
    { headers: { Accept: "application/json" } }
  );
  
  const archivesData = await archivesResponse.json();
  const recentArchives = (archivesData.archives || []).slice(-2);  // Last 2 months
  
  // 2. Fetch each archive and filter games by date
  for (const archiveUrl of recentArchives) {
    const archiveResponse = await fetchWithTimeout(archiveUrl, { headers: { Accept: "application/json" } });
    const data: ChessComArchive = await archiveResponse.json();
    
    for (const game of (data.games || [])) {
      if (game.time_class === timeClass && game.end_time) {
        const endMs = game.end_time * 1000;  // Convert to milliseconds
        
        // Filter by actual date windows
        if (endMs >= since24h) { games24h++; games7d++; }
        else if (endMs >= since7d) { games7d++; }
      }
    }
  }
  
  return { games24h, games7d };
}
```

### How it works:
1. ✅ Fetches game archives from Chess.com API
2. ✅ Gets last 2 months of archives (`slice(-2)`)
3. ✅ Iterates through actual game records
4. ✅ Filters games by `end_time` timestamp:
   - If `end_time >= since24h` → counts in both 24h and 7d
   - Else if `end_time >= since7d` → counts only in 7d
5. ✅ Returns accurate counts for actual time windows

### Advantages:
- ✅ **Time-Based**: Actually filters by 24h/7d windows
- ✅ **No Cold Start Problem**: Works correctly on first run
- ✅ **Accurate**: Counts actual games played in the time period, not deltas

---

## 3. LICHESS - Alternative Implementation (in `player-lookup` route)

### Location: `src/app/api/player-lookup/route.ts` (lines 132-157)

### Approach: **HISTORY FILTER** (✅ Smart - but NOT used in cron route!)

```typescript
async function countLichessGames(
  username: string,
  perfType: "rapid" | "blitz",
  sinceMs: number,
  max: number,
  debug: { errors: string[] }
): Promise<{ count: number; status: number | null }> {
  const response = await fetchWithTimeout(
    `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=${max}&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`,
    { headers: { Accept: "application/x-ndjson" } }
  );
  
  if (response.ok) {
    const text = await response.text();
    // Count lines (each line is one game)
    const count = text.split("\n").filter((line) => line.trim().length > 0).length;
    return { count, status: response.status };
  }
}
```

### How it works:
1. ✅ Fetches games from Lichess API with `since=${sinceMs}` parameter
2. ✅ Lichess API filters games by date on the server side
3. ✅ Counts returned games (one per line in NDJSON format)
4. ✅ Returns accurate count for the time period

### Advantages:
- ✅ **Time-Based**: Uses `since` parameter to get games from specific date
- ✅ **No Cold Start Problem**: Works correctly on first run
- ✅ **Server-Side Filtering**: Lichess API does the date filtering (efficient)

---

## Side-by-Side Comparison

| Aspect | Lichess (update-stats) | Chess.com (player-lookup) | Lichess (player-lookup) |
|--------|----------------------|--------------------------|------------------------|
| **Approach** | ❌ Snapshot Delta | ✅ History Filter | ✅ History Filter |
| **Fetches Game History?** | ❌ No | ✅ Yes (archives) | ✅ Yes (games API) |
| **Filters by Date?** | ❌ No | ✅ Yes (`end_time`) | ✅ Yes (`since` param) |
| **Cold Start Safe?** | ❌ No (shows 0) | ✅ Yes | ✅ Yes |
| **24h Window Accurate?** | ❌ No (delta, not 24h) | ✅ Yes | ✅ Yes |
| **7d Window Accurate?** | ❌ No (delta, not 7d) | ✅ Yes | ✅ Yes |
| **Used in Cron?** | ✅ Yes | ❌ No (not implemented) | ❌ No (not implemented) |

---

## Root Cause Analysis

### Why Lichess Stats Reset to 0:

1. **Cold Start**: First snapshot has `prevRapidTotal = 0`, so `rapidDelta = 0` (even if player has 1000 games)
2. **Not Time-Based**: Code calculates `current_total - previous_total`, which is NOT the same as "games in last 24h"
3. **Missing Snapshots**: If previous snapshot is deleted, stats reset to 0

### Why Chess.com Stats Seem Stable:

1. **Not in Cron Route**: Chess.com logic exists in `player-lookup` but NOT in `update-stats` route
2. **If Used**: Would use History Filter approach, which is time-based and accurate
3. **Actually**: Chess.com stats might not be updated by cron at all (need to verify)

---

## Recommendation

**Replace the "Snapshot Delta" approach in `update-stats` route with "History Filter" approach** (like `player-lookup` route does):

1. For **Lichess**: Use `countLichessGames()` function (already exists in `player-lookup`)
2. For **Chess.com**: Use `countChessComGames()` function (already exists in `player-lookup`)
3. Remove the delta calculation logic (lines 31-58 in `update-stats` route)
4. Directly save the counts from history filtering

This will make stats:
- ✅ Accurate (actual 24h/7d windows)
- ✅ Stable (no cold start problems)
- ✅ Consistent (same approach for both platforms)
