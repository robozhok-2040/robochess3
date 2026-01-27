import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type WoodpeckerAttemptPayload = {
  cycleId: string;
  puzzleId: string;
  isCorrect: boolean;
  timeSpentSeconds: number;
};

export async function POST(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Unauthorized (dev user id missing)" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as Partial<WoodpeckerAttemptPayload>;
    const cycleId = typeof body.cycleId === "string" ? body.cycleId.trim() : "";
    const puzzleId = typeof body.puzzleId === "string" ? body.puzzleId.trim() : "";
    const isCorrect = body.isCorrect;
    const timeSpentSeconds = body.timeSpentSeconds;

    if (!cycleId || !puzzleId) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    if (typeof isCorrect !== "boolean") {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    if (typeof timeSpentSeconds !== "number" || !Number.isFinite(timeSpentSeconds) || timeSpentSeconds < 0) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }

    await prisma.training_logs.create({
      data: {
        student_id: userId,
        activity_type: "woodpecker_attempt",
        success: isCorrect,
        score: isCorrect ? 1 : 0,
        details: {
          cycleId,
          puzzleId,
          isCorrect,
          timeSpentSeconds,
          at: new Date().toISOString(),
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[STUDENT_WOODPECKER_ATTEMPT] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

