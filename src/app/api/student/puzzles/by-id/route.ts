import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentUserId } from "@/lib/server/studentAuth";

type PuzzleDTO = {
  id: string;
  fen: string;
  rating: number | null;
  themes: string[] | null;
  themePrimary?: string | null;
  solutionMoves?: string[] | null;
  sideToMove?: string | null;
  puzzleMode?: string | null;
  movesToMate?: number | null;
  source?: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const userId = await getStudentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Unauthorized (dev user id missing)" },
        { status: 401 }
      );
    }

    const puzzleId = request.nextUrl.searchParams.get("puzzleId")?.trim();
    if (!puzzleId) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
    }

    const puzzle = await prisma.chess_puzzles.findUnique({
      where: { id: puzzleId },
      select: {
        id: true,
        fen: true,
        elo_rating: true,
        themes: true,
        theme_primary: true,
        solution_moves: true,
        side_to_move: true,
        puzzle_mode: true,
        moves_to_mate: true,
        source: true,
      },
    });

    if (!puzzle) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const response: PuzzleDTO = {
      id: puzzle.id,
      fen: puzzle.fen,
      rating: puzzle.elo_rating ?? null,
      themes: puzzle.themes ?? null,
      themePrimary: puzzle.theme_primary ?? null,
      solutionMoves: puzzle.solution_moves ?? null,
      sideToMove: puzzle.side_to_move ?? null,
      puzzleMode: puzzle.puzzle_mode ?? null,
      movesToMate: puzzle.moves_to_mate ?? null,
      source: puzzle.source ?? null,
    };

    return NextResponse.json({ puzzle: response });
  } catch (error) {
    console.error("[STUDENT_PUZZLES_BY_ID] Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

