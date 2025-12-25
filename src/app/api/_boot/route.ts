import { NextResponse } from 'next/server';
import { startScheduler } from '@/lib/cron/scheduler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Boot endpoint to initialize server-side services like the scheduler
 * Access at /api/_boot
 */
export async function GET() {
  try {
    // Check if scheduler is already running using globalThis guard
    const g = globalThis as any;
    const globalKey = '__rcSchedulerStarted';
    if (g[globalKey]) {
      return NextResponse.json({
        ok: true,
        started: false,
      });
    }

    // Start the scheduler (has its own singleton guard)
    startScheduler();
    g[globalKey] = true;
    console.log('[BOOT] scheduler started');
    
    return NextResponse.json({
      ok: true,
      started: true,
    });
  } catch (error) {
    console.error('[BOOT] Error starting scheduler:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

