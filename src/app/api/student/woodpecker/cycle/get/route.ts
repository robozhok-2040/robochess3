import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

export async function GET(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Unauthorized (dev user id missing)" },
        { status: 401 }
      );
    }

    const cycleId = request.nextUrl.searchParams.get("cycleId")?.trim();
    if (!cycleId) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }

    const cycleLog = await prisma.training_logs.findFirst({
      where: {
        student_id: userId,
        activity_type: "woodpecker_cycle",
        details: {
          path: ["cycleId"],
          equals: cycleId,
        } as any,
      },
      orderBy: { created_at: "desc" },
      select: { details: true },
    });

    if (!cycleLog?.details) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({ cycle: cycleLog.details });
  } catch (error) {
    console.error("[STUDENT_WOODPECKER_CYCLE_GET] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

