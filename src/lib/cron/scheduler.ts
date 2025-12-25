/**
 * Internal scheduler for periodic stats v2 updates
 * Server-only module - should not run in browser
 */

const SCHEDULE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INITIAL_DELAY_MS = 5000; // 5 seconds after start

let schedulerStarted = false;
let schedulerIntervalId: NodeJS.Timeout | null = null;

/**
 * Get the base URL for internal API calls
 */
function getBaseUrl(): string {
  // Server-side only: use environment variable or default to localhost
  if (typeof window === 'undefined') {
    // Prefer explicit app URL from env
    if (process.env.NEXT_PUBLIC_APP_URL) {
      return process.env.NEXT_PUBLIC_APP_URL;
    }
    
    // For Vercel deployments, construct from VERCEL_URL
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    
    // Default to localhost for self-hosted/local development
    const port = process.env.PORT || '3000';
    return `http://localhost:${port}`;
  }
  
  // Browser-side (shouldn't happen in scheduler, but fallback)
  return window.location.origin;
}

/**
 * Run the stats v2 update job
 */
async function runStatsUpdateJob(): Promise<void> {
  const startTime = Date.now();
  console.log('[SCHEDULER] Starting stats v2 update job...');

  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/api/cron/update-stats-v2?limit=100&offset=0`;
    
    // Add a timeout to prevent hanging (10 minutes)
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (result.ok) {
      const processed = result.processed || 0;
      const total = result.total || 0;
      const errors = result.errors?.length || 0;
      console.log(
        `[SCHEDULER] Stats v2 update completed in ${duration}s: processed ${processed}/${total}, errors ${errors}`
      );
    } else {
      console.error(`[SCHEDULER] Stats v2 update failed: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(
      `[SCHEDULER] Error in stats v2 update job (${duration}s):`,
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - continue with next cycle
  }
}

/**
 * Start the scheduler (singleton - only runs once)
 * Should only be called on the server side
 */
export function startScheduler(): void {
  // Guard: ensure this only runs on server
  if (typeof window !== 'undefined') {
    console.warn('[SCHEDULER] Attempted to start scheduler in browser - ignoring');
    return;
  }

  // Singleton guard using module-level variable
  if (schedulerStarted) {
    console.log('[SCHEDULER] Scheduler already started - skipping');
    return;
  }

  // Also check globalThis as additional safeguard
  const globalKey = '__robochess_scheduler_started__';
  if ((globalThis as any)[globalKey]) {
    console.log('[SCHEDULER] Scheduler already started (global check) - skipping');
    return;
  }

  schedulerStarted = true;
  (globalThis as any)[globalKey] = true;

  console.log('[SCHEDULER] Starting internal stats v2 scheduler (every 6 hours)');

  // Run immediately after initial delay
  setTimeout(() => {
    runStatsUpdateJob().catch((error) => {
      console.error('[SCHEDULER] Initial job error:', error);
    });
  }, INITIAL_DELAY_MS);

  // Then schedule recurring job every 6 hours
  schedulerIntervalId = setInterval(() => {
    runStatsUpdateJob().catch((error) => {
      console.error('[SCHEDULER] Recurring job error:', error);
    });
  }, SCHEDULE_INTERVAL_MS);

  console.log(`[SCHEDULER] Scheduler started - will run every ${SCHEDULE_INTERVAL_MS / 1000 / 60 / 60} hours`);
}

/**
 * Stop the scheduler (useful for cleanup in tests)
 */
export function stopScheduler(): void {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    schedulerStarted = false;
    delete (globalThis as any).__robochess_scheduler_started__;
    console.log('[SCHEDULER] Scheduler stopped');
  }
}

