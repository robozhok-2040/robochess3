import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type IchuckyAttemptPayload = {
  isCorrect?: boolean;
  streakAfter?: number;
  piecesCount?: number;
  targetSquare?: string;
  correctPieceId?: string;
  correctPieceLabel?: string;
  chosenPieceId?: string;
  chosenPieceLabel?: string;
  timeSpentSeconds?: number | null;
};

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as IchuckyAttemptPayload;
    const isCorrect = body.isCorrect === true;
    const streakAfter = Number.isFinite(body.streakAfter) ? Number(body.streakAfter) : null;
    const piecesCount = Number.isFinite(body.piecesCount) ? Number(body.piecesCount) : null;
    const timeSpentSeconds =
      typeof body.timeSpentSeconds === "number" && Number.isFinite(body.timeSpentSeconds)
        ? body.timeSpentSeconds
        : null;

    await prisma.training_logs.create({
      data: {
        student_id: userId,
        activity_type: "ichucky",
        success: isCorrect,
        score: isCorrect ? 1 : 0,
        details: {
          isCorrect,
          streakAfter,
          piecesCount,
          targetSquare: typeof body.targetSquare === "string" ? body.targetSquare : null,
          correctPieceId: typeof body.correctPieceId === "string" ? body.correctPieceId : null,
          correctPieceLabel: typeof body.correctPieceLabel === "string" ? body.correctPieceLabel : null,
          chosenPieceId: typeof body.chosenPieceId === "string" ? body.chosenPieceId : null,
          chosenPieceLabel: typeof body.chosenPieceLabel === "string" ? body.chosenPieceLabel : null,
          timeSpentSeconds,
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[STUDENT_ICHUCKY_ATTEMPT] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

