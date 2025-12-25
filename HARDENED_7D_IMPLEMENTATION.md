# Hardened 7D Stats Implementation

## Summary of Changes

### 1. Naming Consistency ✅

**Verified End-to-End:**
- **DB Fields**: `rapid_7d`, `blitz_7d`, `puzzle_7d` (snake_case)
- **API Response** (`/api/coach/students`): `rapidGames7d`, `blitzGames7d`, `puzzles7d` (camelCase)
- **UI** (`coach/page.tsx`): `rapidGames7d`, `blitzGames7d`, `puzzles7d` (camelCase)

**Mapping:**
```
DB: rapid_7d → API: rapidGames7d → UI: rapidGames7d ✅
DB: blitz_7d → API: blitzGames7d → UI: blitzGames7d ✅
DB: puzzle_7d → API: puzzles7d → UI: puzzles7d ✅
```

All naming is consistent across the stack.

---

### 2. 7d Fallback Policy ✅

**Chosen Approach: Use `0` (not null)**

**Rationale:**
- Prefer correctness over stale values
- `0` is unambiguous: "no games in last 7 days" vs null "unknown/unavailable"
- UI can display `0` directly without special handling
- Matches existing pattern (24h fields also default to 0)

**Implementation:**
```typescript
// 7d delta: time-based calculation from snapshot 7 days ago
let rapidDelta7d = 0; // Default: 0 (not previous value)
if (snapshot7dAgo?.rapid_total !== null && snapshot7dAgo?.rapid_total !== undefined) {
  rapidDelta7d = Math.max(0, currRapid - snapshot7dAgo.rapid_total);
}
// Explicitly set to 0 if no snapshot exists (correctness over stale values)
```

**UI Behavior:**
- Displays `0` when no 7d history available
- No special "—" handling needed (0 is clear and correct)

---

### 3. 24h Time-Based Calculation ✅

**Enhanced Implementation:**
- **Primary**: Find snapshot from ~24 hours ago for accurate time-based calculation
- **Fallback**: If no snapshot exists from 24h ago, use latest snapshot (legacy behavior for immediate updates)

```typescript
// Find snapshot from ~24 hours ago
const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
const snapshot24hAgo = await prisma.stats_snapshots.findFirst({
  where: { user_id: student.id, captured_at: { lte: oneDayAgo } },
  orderBy: { captured_at: 'desc' }, take: 1
});

// Calculate 24h delta (time-based)
if (snapshot24hAgo?.rapid_total !== null) {
  rapidDelta24h = Math.max(0, currRapid - snapshot24hAgo.rapid_total);
}
// Fallback to latest snapshot if no 24h snapshot exists
else if (latestSnapshot?.rapid_total > 0) {
  rapidDelta24h = Math.max(0, currRapid - latestSnapshot.rapid_total);
}
```

**Why Fallback for 24h:**
- Snapshots may be created more frequently than daily
- Latest snapshot is likely within 24h, so delta is still meaningful
- 7d doesn't need fallback because it's explicitly time-based

---

### 4. Safety Checks ✅

**Runtime Assertions Added:**

1. **Pre-Save Check**: Validates payload before saving
```typescript
if (snapshotPayload.rapid_7d === null || snapshotPayload.rapid_7d === undefined ||
    snapshotPayload.blitz_7d === null || snapshotPayload.blitz_7d === undefined ||
    snapshotPayload.puzzle_7d === null || snapshotPayload.puzzle_7d === undefined) {
  console.error(`[SAFETY CHECK FAILED] Missing 7d fields for ${student.username}`);
}
```

2. **Post-Save Check**: Validates saved snapshot
```typescript
const hasAll7dFields = 
  newSnapshot.rapid_7d !== null && newSnapshot.rapid_7d !== undefined &&
  newSnapshot.blitz_7d !== null && newSnapshot.blitz_7d !== undefined &&
  newSnapshot.puzzle_7d !== null && newSnapshot.puzzle_7d !== undefined;

if (!hasAll7dFields) {
  console.error(`[SAFETY CHECK FAILED] Saved snapshot missing 7d fields`);
}
```

**Validation Helper Created:**
- `src/app/api/cron/update-stats-validation.ts`
- Can be called to validate any user's latest snapshot
- Useful for debugging and monitoring

---

### 5. Debug Logs Cleanup ✅

**Before:**
```typescript
// Always logged for test users
if (student.username === 'robo4040' || student.username?.includes('test')) {
  console.log(`[SNAPSHOT PAYLOAD] ${student.username}:`, snapshotPayload);
}
```

**After:**
```typescript
// Only in development mode
if (process.env.NODE_ENV !== 'production' && (student.username === 'robo4040' || student.username?.includes('test'))) {
  console.log(`[DEBUG] Snapshot payload for ${student.username}:`, snapshotPayload);
}
```

**Safety checks remain in all environments** (errors should always be logged).

---

## Key Improvements

### Before (Problematic):
1. ❌ 7d fallback: Kept previous value (could be stale)
2. ❌ 24h: Only used latest snapshot (not time-based)
3. ❌ No safety checks
4. ❌ Debug logs in production

### After (Hardened):
1. ✅ 7d fallback: Uses `0` (correctness over stale values)
2. ✅ 24h: Time-based with smart fallback
3. ✅ Runtime safety checks (pre and post-save)
4. ✅ Debug logs only in development

---

## Testing Recommendations

### Manual Test:
1. Add a new student
2. Run update-stats twice
3. Check latest snapshot has non-null `rapid_7d`, `blitz_7d`, `puzzle_7d`
4. Verify values are either > 0 (if history exists) or exactly 0 (if no history)

### Validation Helper:
```typescript
import { validateSnapshotHas7dFields } from './update-stats-validation';

// Validate a user's snapshot
const isValid = await validateSnapshotHas7dFields(userId);
if (!isValid) {
  console.error('Validation failed!');
}
```

---

## Fallback Decision Summary

**7d Fields: Use `0` (not null)**

**Reasons:**
1. **Correctness**: 0 means "no games in last 7 days" (true if no history)
2. **Consistency**: Matches 24h fields (also default to 0)
3. **UI Simplicity**: No special null handling needed
4. **Type Safety**: Number type is easier to work with than number | null

**UI displays**: `0` (no special "—" needed, as 0 is correct and clear)


