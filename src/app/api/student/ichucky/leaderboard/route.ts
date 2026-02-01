import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type LeaderboardRow = {
  user_id: string;
  best_streak: number | null;
};

type LeaderboardResponse = {
  me: { userId: string; bestStreak: number };
  top: Array<{ userId: string; label: string; bestStreak: number }>;
};

export async function GET(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        {
          error: "UNAUTHORIZED",
          message: "No student auth. In dev set DEV_STUDENT_ID in .env.local.",
        },
        { status: 401 }
      );
    }

    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limitValue = Number(limitRaw);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 50) : 10;

    const topRows = await prisma.$queryRaw<LeaderboardRow[]>`
      SELECT student_id AS user_id,
             MAX(COALESCE((details->>'streakAfter')::int, (details->>'streak')::int, 0)) AS best_streak
      FROM training_logs
      WHERE activity_type = 'ichucky'
      GROUP BY student_id
      ORDER BY best_streak DESC
      LIMIT ${limit}
    `;

    const meRows = await prisma.$queryRaw<LeaderboardRow[]>`
      SELECT student_id AS user_id,
             MAX(COALESCE((details->>'streakAfter')::int, (details->>'streak')::int, 0)) AS best_streak
      FROM training_logs
      WHERE activity_type = 'ichucky'
        AND student_id = ${userId}
      GROUP BY student_id
    `;

    const allUserIds = Array.from(
      new Set([...topRows.map((row) => row.user_id), userId])
    );
    const profiles = allUserIds.length
      ? await prisma.profiles.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, username: true, full_name: true },
        })
      : [];
    const profileMap = new Map(
      profiles.map((profile) => [profile.id, profile.username || profile.full_name || ""])
    );

    const top = topRows.map((row) => ({
      userId: row.user_id,
      label: profileMap.get(row.user_id) || `Учень ${row.user_id.slice(0, 6)}`,
      bestStreak: row.best_streak ?? 0,
    }));

    const meBest = meRows[0]?.best_streak ?? 0;

    const response: LeaderboardResponse = {
      me: { userId, bestStreak: meBest },
      top,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[STUDENT_ICHUCKY_LEADERBOARD] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

