import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const testEmail = "test_db_check@example.com";
    const testUsername = "TEST_PLAYER_DB_CHECK";

    // 1. Create/Find Test User (using findFirst since email might not be unique)
    let user = await prisma.profiles.findFirst({
      where: { username: testUsername }
    });

    if (!user) {
      user = await prisma.profiles.create({
        data: {
          email: testEmail,
          username: testUsername,
          role: "student"
        }
      });
    }

    // 2. Create/Update Connection
    const existingConn = await prisma.platform_connections.findFirst({
      where: { user_id: user.id, platform: 'lichess' }
    });

    if (!existingConn) {
      await prisma.platform_connections.create({
        data: {
          user_id: user.id,
          platform: 'lichess',
          platform_username: 'test_bot_999'
        }
      });
    } else {
      await prisma.platform_connections.update({
        where: { id: existingConn.id },
        data: { platform_username: 'test_bot_999' }
      });
    }

    // 3. FORCE WRITE STATS (The critical part)
    // We try to write to the NEW columns specifically.
    const snapshot = await prisma.stats_snapshots.create({
      data: {
        user_id: user.id,
        source: "manual_test",
        rapid_24h: 555,        // Rapid (new field name)
        blitz_24h: 999,        // Blitz (new field name)
        captured_at: new Date()
      }
    });

    // 4. READ IT BACK
    const check = await prisma.stats_snapshots.findUnique({
      where: { id: snapshot.id }
    });

    return NextResponse.json({
      status: "TEST COMPLETED",
      message: "If you see 999 below, the DB is working perfectly.",
      write_result: {
        id: check?.id,
        saved_rapid: check?.rapid_24h,       // Should be 555
        saved_blitz: check?.blitz_24h        // Should be 999
      }
    });

  } catch (e) {
    return NextResponse.json({ 
      status: "DB BROKEN", 
      error: String(e),
      hint: "If the error mentions 'Unknown argument', run 'npx prisma db push' again."
    }, { status: 500 });
  }
}
