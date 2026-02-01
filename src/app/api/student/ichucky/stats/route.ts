import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type IchuckyLogDetails = {
  isCorrect?: boolean;
  timeSpentSeconds?: number | null;
  piecesCount?: number | null;
};

function normalizeDetails(details: unknown): IchuckyLogDetails {
  if (!details || typeof details !== "object") {
    return {};
  }
  const record = details as Record<string, unknown>;
  const isCorrect = record.isCorrect === true;
  const timeSpentSeconds =
    typeof record.timeSpentSeconds === "number" && Number.isFinite(record.timeSpentSeconds)
      ? record.timeSpentSeconds
      : null;
  const piecesCount =
    typeof record.piecesCount === "number" && Number.isFinite(record.piecesCount)
      ? record.piecesCount
      : null;

  return { isCorrect, timeSpentSeconds, piecesCount };
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Unauthorized (missing student auth). In dev set DEV_STUDENT_ID or pass x-dev-user-id header.",
        },
        { status: 401 }
      );
    }

    const from7d = new Date();
    from7d.setDate(from7d.getDate() - 7);

    const logs = await prisma.training_logs.findMany({
      where: {
        student_id: userId,
        activity_type: "ichucky",
        created_at: {
          gte: from7d,
        },
      },
      select: {
        created_at: true,
        details: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const attempts7d = logs.length;
    let correct7d = 0;
    const timeValues: number[] = [];

    for (const log of logs) {
      const { isCorrect, timeSpentSeconds } = normalizeDetails(log.details);
      if (isCorrect) {
        correct7d += 1;
      }
      if (typeof timeSpentSeconds === "number") {
        timeValues.push(timeSpentSeconds);
      }
    }

    const accuracy7d = attempts7d ? Math.round((correct7d / attempts7d) * 100) : 0;
    const avgTimeSeconds =
      timeValues.length > 0
        ? Math.round(timeValues.reduce((sum, value) => sum + value, 0) / timeValues.length)
        : null;

    let currentStreak = 0;
    for (const log of logs) {
      const { isCorrect } = normalizeDetails(log.details);
      if (!isCorrect) {
        break;
      }
      currentStreak += 1;
    }

    const last10 = logs.slice(0, 10).map((log) => {
      const { isCorrect, timeSpentSeconds, piecesCount } = normalizeDetails(log.details);
      return {
        at: log.created_at ? log.created_at.toISOString() : new Date(0).toISOString(),
        isCorrect: isCorrect === true,
        timeSpentSeconds: timeSpentSeconds ?? null,
        piecesCount: piecesCount ?? null,
      };
    });

    return NextResponse.json({
      last7d: {
        attempts: attempts7d,
        correct: correct7d,
        accuracy: accuracy7d,
        avgTimeSeconds,
      },
      streak: {
        current: currentStreak,
      },
      last10,
    });
  } catch (error) {
    console.error("[STUDENT_ICHUCKY_STATS] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

