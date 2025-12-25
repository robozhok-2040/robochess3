# 7D Stats Bug Fix - Analysis & Resolution

## 1. Code Path Analysis

### Refresh/Update Button Flow:
1. **Button Location**: `src/app/(coach)/coach/page.tsx` line 1195-1207
2. **Handler**: `handleUpdateStats()` (lines 919-944)
3. **API Call**: `fetch("/api/cron/update-stats")` (line 922)
4. **After Update**: `router.refresh()` (line 937) - re-fetches data from `/api/coach/students`

---

## 2. Root Cause Analysis

### Problem: 7d Values Disappear After Update

**Location**: `src/app/api/cron/update-stats/route.ts`

#### BEFORE FIX (Lines 60-83):
```typescript
await prisma.stats_snapshots.create({
  data: {
    user_id: student.id,
    source: "lichess", 
    
    // RATINGS
    rapid_rating: data.perfs?.rapid?.rating ?? null,
    blitz_rating: data.perfs?.blitz?.rating ?? null,
    puzzle_rating: data.perfs?.puzzle?.rating ?? null,

    // DAILY STATS (deltas) - ONLY 24H, NO 7D!
    rapid_24h: rapidDelta,
    blitz_24h: blitzDelta,
    puzzle_24h: puzzleDelta,

    // LIFETIME ACCUMULATORS
    rapid_total: currRapid,
    blitz_total: currBlitz,
    puzzle_total: currPuzzle,
    
    captured_at: new Date()
  }
});
```

**Issues Found:**
1. ❌ **Missing 7d Fields**: Code only saves `rapid_24h`, `blitz_24h`, `puzzle_24h` - NO `rapid_7d`, `blitz_7d`, `puzzle_7d`
2. ❌ **New Snapshot Created**: Uses `create()` not `update()`, so creates a new row each time
3. ❌ **7d Values Default to NULL/0**: When new snapshot is created without 7d fields, they default to NULL/0
4. ❌ **Schema Missing Fields**: Schema didn't have `rapid_7d`, `blitz_7d`, `puzzle_7d` columns

---

## 3. Read API Analysis

### Location: `src/app/api/coach/students/route.ts`

#### BEFORE FIX (Lines 34-47):
```typescript
stats: {
    // RATINGS
    rapidRating: latestStats?.rapid_rating ?? null,
    blitzRating: latestStats?.blitz_rating ?? null,
    puzzleRating: latestStats?.puzzle_rating ?? null,
    
    // DAILY STATS - ONLY 24H, NO 7D!
    rapidGames24h: latestStats?.rapid_24h ?? 0,
    blitzGames24h: latestStats?.blitz_24h ?? 0,
    
    // PUZZLES - NO 7D!
    puzzles3d: latestStats?.puzzle_24h ?? 0,
    puzzle_total: latestStats?.puzzle_total ?? 0,
}
```

**Issues Found:**
1. ❌ **Not Returning 7d Values**: API doesn't return `rapidGames7d`, `blitzGames7d`, `puzzles7d`
2. ✅ **Correct Ordering**: Uses `orderBy: { captured_at: 'desc' }, take: 1` to get latest snapshot

---

## 4. Why 7d Values Disappear

**The Bug Flow:**
1. User adds student → `player-lookup` route may set some 7d values (if they exist in DB)
2. Frontend shows 7d values (if they exist in the snapshot)
3. User clicks "Refresh/Update" → calls `/api/cron/update-stats`
4. `update-stats` creates NEW snapshot WITHOUT 7d fields → they default to NULL/0
5. Frontend refreshes → reads latest snapshot (now has NULL/0 for 7d)
6. **Result**: 7d values disappear! ❌

---

## 5. The Fix

### Step 1: Added 7d Fields to Schema
**File**: `prisma/schema.prisma`

```prisma
// --- RAPID ---
rapid_rating Int? @default(0)
rapid_24h    Int? @default(0)
rapid_7d     Int? @default(0)  // ✅ ADDED
rapid_total  Int? @default(0)

// --- BLITZ ---
blitz_rating Int? @default(0)
blitz_24h    Int? @default(0)
blitz_7d     Int? @default(0)  // ✅ ADDED
blitz_total  Int? @default(0)

// --- PUZZLES ---
puzzle_rating Int? @default(0)
puzzle_24h    Int? @default(0)
puzzle_7d     Int? @default(0)  // ✅ ADDED
puzzle_total  Int? @default(0)
```

**Command**: `npx prisma db push` ✅ (Schema synced successfully)

---

### Step 2: Calculate and Save 7d Values
**File**: `src/app/api/cron/update-stats/route.ts`

**Key Changes:**
1. ✅ Find snapshot from ~7 days ago for accurate 7d delta calculation
2. ✅ Calculate 7d delta: `current_total - snapshot_7d_ago_total`
3. ✅ Fallback: If no snapshot exists from 7 days ago, keep previous 7d value
4. ✅ Save 7d values in new snapshot

**Code Snippet:**
```typescript
// Find snapshot from ~7 days ago
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const snapshot7dAgo = await prisma.stats_snapshots.findFirst({
  where: {
    user_id: student.id,
    captured_at: { lte: sevenDaysAgo }
  },
  orderBy: { captured_at: 'desc' },
  take: 1
});

// Calculate 7d delta
let rapidDelta7d = latestSnapshot?.rapid_7d ?? 0; // Default: keep previous
if (snapshot7dAgo?.rapid_total !== null && snapshot7dAgo?.rapid_total !== undefined) {
  rapidDelta7d = Math.max(0, currRapid - (snapshot7dAgo.rapid_total ?? 0));
}

// Save in snapshot
await prisma.stats_snapshots.create({
  data: {
    // ... other fields ...
    rapid_7d: rapidDelta7d,  // ✅ NOW SAVED
    blitz_7d: blitzDelta7d,  // ✅ NOW SAVED
    puzzle_7d: puzzleDelta7d, // ✅ NOW SAVED
  }
});
```

---

### Step 3: Return 7d Values in API
**File**: `src/app/api/coach/students/route.ts`

**Code Snippet:**
```typescript
stats: {
    // ... ratings ...
    
    // 24H STATS
    rapidGames24h: latestStats?.rapid_24h ?? 0,
    blitzGames24h: latestStats?.blitz_24h ?? 0,
    
    // 7D STATS - ✅ NOW RETURNED
    rapidGames7d: latestStats?.rapid_7d ?? 0,
    blitzGames7d: latestStats?.blitz_7d ?? 0,
    
    // PUZZLES
    puzzles3d: latestStats?.puzzle_24h ?? 0,
    puzzles7d: latestStats?.puzzle_7d ?? 0,  // ✅ NOW RETURNED
    puzzle_total: latestStats?.puzzle_total ?? 0,
}
```

---

### Step 4: Added Debug Logs
**File**: `src/app/api/cron/update-stats/route.ts`

Debug logs added to track:
- Before update: `latestSnapshot.rapid_7d`, `blitz_7d`, `puzzle_7d`
- Snapshot payload: All values being saved
- After update: New snapshot values

**To view logs**: Check server console when running update for user 'robo4040' or any user with 'test' in username.

---

## 6. Summary

### Why 7d Values Disappeared:
- ❌ Schema didn't have `rapid_7d`, `blitz_7d`, `puzzle_7d` columns
- ❌ Update-stats route didn't calculate or save 7d values
- ❌ Students route didn't return 7d values
- ✅ Result: New snapshots had NULL/0 for 7d, overwriting previous values

### The Fix:
1. ✅ Added `rapid_7d`, `blitz_7d`, `puzzle_7d` to schema and synced DB
2. ✅ Calculate 7d deltas using snapshot from 7 days ago
3. ✅ Preserve previous 7d value if no snapshot exists from 7 days ago
4. ✅ Save 7d values in new snapshot payload
5. ✅ Return 7d values in students API response
6. ✅ Added debug logs for troubleshooting

### Result:
- ✅ 7d values now persist after Refresh/Update
- ✅ Accurate 7d calculation based on snapshot from 7 days ago
- ✅ Graceful fallback to previous value if history unavailable


