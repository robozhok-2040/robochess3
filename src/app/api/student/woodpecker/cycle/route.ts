import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type CycleRequest = {
  rating?: number;
  delta?: number;
  themes?: string[];
  size?: number;
};

function shuffle<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Unauthorized (dev user id missing)" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as CycleRequest;
    const rating = Number.isFinite(body.rating) ? Number(body.rating) : 1800;
    const delta = Number.isFinite(body.delta) ? Number(body.delta) : 100;
    const size = Number.isFinite(body.size) ? Number(body.size) : 50;
    const themes = Array.isArray(body.themes)
      ? body.themes.map((theme) => String(theme).trim()).filter(Boolean)
      : [];

    if (!Number.isFinite(rating) || !Number.isFinite(delta) || rating <= 0 || delta < 0) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }

    const where: Record<string, unknown> = {
      elo_rating: {
        not: null,
        gte: rating - delta,
        lte: rating + delta,
      },
    };
    if (themes.length > 0) {
      where.themes = { hasSome: themes };
    }

    const count = await prisma.chess_puzzles.count({ where });
    if (count === 0) {
      return NextResponse.json({ error: "NO_PUZZLES_FOUND" }, { status: 404 });
    }

    const windowSize = Math.min(count, size * 3);
    const skipMax = Math.max(count - windowSize, 0);
    const randomSkip = Math.floor(Math.random() * (skipMax + 1));

    const window = await prisma.chess_puzzles.findMany({
      where,
      orderBy: { id: "asc" },
      skip: randomSkip,
      take: windowSize,
      select: { id: true },
    });

    const ids = window.map((row) => row.id);
    shuffle(ids);
    const puzzleIds = ids.slice(0, Math.min(size, ids.length));

    const cycleId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await prisma.training_logs.create({
      data: {
        student_id: userId,
        activity_type: "woodpecker_cycle",
        details: {
          cycleId,
          createdAt,
          rating,
          delta,
          themes,
          size,
          puzzleIds,
        },
      },
    });

    return NextResponse.json({
      cycleId,
      size,
      rating,
      delta,
      themes,
      puzzleIds,
      puzzleIdsCount: puzzleIds.length,
      firstPuzzleId: puzzleIds[0] ?? null,
    });
  } catch (error) {
    console.error("[STUDENT_WOODPECKER_CYCLE] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

