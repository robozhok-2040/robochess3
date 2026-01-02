import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// --- TYPES ---
type LichessUser = {
  perfs?: {
    rapid?: { rating?: number };
    blitz?: { rating?: number };
    puzzle?: { rating?: number; games?: number };
  };
};

type LichessActivity = {
  interval?: { start: number; end: number };
  puzzles?: { score: number; win: number; loss: number; draw: number };
};

type ChessComStats = {
  chess_rapid?: { last?: { rating?: number } };
  chess_blitz?: { last?: { rating?: number } };
  tactics?: {
    highest?: { rating?: number };
    last?: { rating?: number };
  };
};

type ChessComGame = {
  time_class?: string;
  end_time?: number;
};

type ChessComArchive = {
  games?: ChessComGame[];
};

type PlayerRow = {
  id: string;
  nickname: string;
  platform: "lichess" | "chesscom";
  handle: string;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  rapidRating: number | null;
  blitzRating: number | null;
  puzzlesSolved24h: number; // Вже не placeholder!
  puzzleRating: number | null;
  homeworkCompletionPct: number;
  lastActiveLabel: string;
};

type PlayerLookupResponse = {
  rows: PlayerRow[];
  debug?: any;
};

// --- HELPERS ---

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Нова функція для отримання пазлів за 24 години
async function fetchLichessPuzzleActivity(username: string): Promise<number> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/user/${username}/activity`,
      { headers: { Accept: "application/json" } }
    );

    if (!response.ok) return 0;

    const activities: LichessActivity[] = await response.json();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let puzzleCount = 0;

    for (const act of activities) {
      // Перевіряємо, чи активність була за останні 24 години і чи це пазли
      if (act.interval && act.interval.end > oneDayAgo && act.puzzles) {
        // win = правильно вирішені. Якщо хочете рахувати і неправильні, додайте + act.puzzles.loss
        puzzleCount += (act.puzzles.win || 0);
      }
    }
    return puzzleCount;
  } catch (error) {
    console.error(`Error fetching puzzles for ${username}:`, error);
    return 0;
  }
}

async function fetchLichessUser(
  username: string,
  debug: { errors: string[] }
): Promise<{ user: LichessUser | null; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/user/${username}`,
      { headers: { Accept: "application/json" } }
    );
    if (response.ok) {
      const user = await response.json();
      return { user, status: response.status };
    } else {
      debug.errors.push(`Profile fetch failed: ${response.status} ${response.statusText}`);
      return { user: null, status: response.status };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Profile fetch error: ${errorMsg}`);
    return { user: null, status: null };
  }
}

async function countLichessGames(
  username: string,
  perfType: "rapid" | "blitz",
  sinceMs: number,
  max: number,
  debug: { errors: string[] }
): Promise<{ count: number; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://lichess.org/api/games/user/${username}?since=${sinceMs}&max=${max}&perfType=${perfType}&moves=false&clocks=false&evals=false&opening=false&pgnInJson=false`,
      { headers: { Accept: "application/x-ndjson" } }
    );
    if (response.ok) {
      const text = await response.text();
      const count = text.split("\n").filter((line) => line.trim().length > 0).length;
      return { count, status: response.status };
    } else {
      debug.errors.push(`Games ${perfType} since=${sinceMs} failed: ${response.status}`);
      return { count: 0, status: response.status };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    debug.errors.push(`Games error: ${errorMsg}`);
    return { count: 0, status: null };
  }
}

// ... (Функції Chess.com залишаємо без змін, вони тут скорочені для ясності, 
// але в повному файлі вони мають бути такими, як у вас були. 
// Я вставлю Chess.com логіку повністю, щоб ви могли просто скопіювати файл)

async function fetchChessComProfile(
  username: string,
  debug: { errors: string[] }
): Promise<{ found: boolean; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) debug.errors.push(`Profile fetch failed: ${response.status}`);
    return { found: response.ok, status: response.status };
  } catch (error) {
    debug.errors.push(`Profile fetch error: ${error}`);
    return { found: false, status: null };
  }
}

async function fetchChessComStats(
  username: string,
  debug: { errors: string[] }
): Promise<{ stats: ChessComStats | null; status: number | null }> {
  try {
    const response = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}/stats`,
      { headers: { Accept: "application/json" } }
    );
    if (response.ok) {
      return { stats: await response.json(), status: response.status };
    }
    return { stats: null, status: response.status };
  } catch (error) {
    return { stats: null, status: null };
  }
}

async function countChessComGames(
  username: string,
  timeClass: "rapid" | "blitz",
  since24h: number,
  since7d: number,
  debug: { errors: string[]; archiveFetchStatuses: number[] }
): Promise<{ games24h: number; games7d: number }> {
  let games24h = 0;
  let games7d = 0;
  try {
    const archivesResponse = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${username}/games/archives`,
      { headers: { Accept: "application/json" } }
    );
    if (!archivesResponse.ok) return { games24h: 0, games7d: 0 };

    const archivesData = await archivesResponse.json();
    const recentArchives = (archivesData.archives || []).slice(-2);

    for (const archiveUrl of recentArchives) {
      try {
        const archiveResponse = await fetchWithTimeout(archiveUrl, { headers: { Accept: "application/json" } });
        if (archiveResponse.ok) {
          const data: ChessComArchive = await archiveResponse.json();
          for (const game of (data.games || [])) {
            if (game.time_class === timeClass && game.end_time) {
              const endMs = game.end_time * 1000;
              if (endMs >= since24h) { games24h++; games7d++; }
              else if (endMs >= since7d) { games7d++; }
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return { games24h, games7d };
}

// --- MAIN HANDLER ---

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get("username");
  const debugMode = searchParams.get("debug") === "1";

  if (!username || !username.trim()) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  const normalizedUsername = username.trim();
  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;
  const since7d = now - 7 * 24 * 60 * 60 * 1000;

  // Debug object init
  const debug = debugMode ? {
    lichess: { errors: [] as string[] },
    chesscom: { errors: [] as string[] },
    timingsMs: {}
  } : null;

  // 1. LICHESS LOOKUP
  const { user: lichessUser } = await fetchLichessUser(normalizedUsername.toLowerCase(), debug ? debug.lichess : { errors: [] });

  let lichessRapid24h = 0, lichessRapid7d = 0;
  let lichessBlitz24h = 0, lichessBlitz7d = 0;
  let lichessPuzzles24h = 0;

  if (lichessUser) {
    const handle = normalizedUsername.toLowerCase();
    // Games
    const r24 = await countLichessGames(handle, "rapid", since24h, 200, debug ? debug.lichess : { errors: [] });
    const r7d = await countLichessGames(handle, "rapid", since7d, 400, debug ? debug.lichess : { errors: [] });
    const b24 = await countLichessGames(handle, "blitz", since24h, 200, debug ? debug.lichess : { errors: [] });
    const b7d = await countLichessGames(handle, "blitz", since7d, 400, debug ? debug.lichess : { errors: [] });
    
    lichessRapid24h = r24.count;
    lichessRapid7d = r7d.count;
    lichessBlitz24h = b24.count;
    lichessBlitz7d = b7d.count;

    // !!! PUZZLES ACTIVITY !!!
    lichessPuzzles24h = await fetchLichessPuzzleActivity(handle);
  }

  // 2. CHESS.COM LOOKUP
  const { found: chessComFound } = await fetchChessComProfile(normalizedUsername, debug ? debug.chesscom : { errors: [] });
  
  let chesscomRapid24h = 0, chesscomRapid7d = 0;
  let chesscomBlitz24h = 0, chesscomBlitz7d = 0;
  let chesscomStats = null;

  if (chessComFound) {
    const s = await fetchChessComStats(normalizedUsername, debug ? debug.chesscom : { errors: [] });
    chesscomStats = s.stats;
    const rapid = await countChessComGames(normalizedUsername, "rapid", since24h, since7d, debug ? debug.chesscom : { errors: [], archiveFetchStatuses: [] });
    const blitz = await countChessComGames(normalizedUsername, "blitz", since24h, since7d, debug ? debug.chesscom : { errors: [], archiveFetchStatuses: [] });
    
    chesscomRapid24h = rapid.games24h;
    chesscomRapid7d = rapid.games7d;
    chesscomBlitz24h = blitz.games24h;
    chesscomBlitz7d = blitz.games7d;
  }

  if (!lichessUser && !chessComFound) {
    return NextResponse.json({ error: "User not found", debug }, { status: 404 });
  }

  const rows: PlayerRow[] = [];

  // Build Lichess Row
  if (lichessUser) {
    const active = (lichessRapid24h + lichessBlitz24h + lichessPuzzles24h) > 0;
    rows.push({
      id: crypto.randomUUID(),
      nickname: normalizedUsername,
      platform: "lichess",
      handle: normalizedUsername.toLowerCase(),
      rapidGames24h: lichessRapid24h,
      rapidGames7d: lichessRapid7d,
      blitzGames24h: lichessBlitz24h,
      blitzGames7d: lichessBlitz7d,
      rapidRating: lichessUser.perfs?.rapid?.rating ?? null,
      blitzRating: lichessUser.perfs?.blitz?.rating ?? null,
      puzzlesSolved24h: lichessPuzzles24h, // ТУТ ТЕПЕР РЕАЛЬНА ЦИФРА
      puzzleRating: lichessUser.perfs?.puzzle?.rating ?? null,
      homeworkCompletionPct: 0,
      lastActiveLabel: active ? "active_24h" : (lichessRapid7d + lichessBlitz7d > 0 ? "active_7d" : "—"),
    });
  }

  // Build Chess.com Row
  if (chessComFound) {
    const active = (chesscomRapid24h + chesscomBlitz24h) > 0;
    rows.push({
      id: crypto.randomUUID(),
      nickname: normalizedUsername,
      platform: "chesscom",
      handle: normalizedUsername,
      rapidGames24h: chesscomRapid24h,
      rapidGames7d: chesscomRapid7d,
      blitzGames24h: chesscomBlitz24h,
      blitzGames7d: chesscomBlitz7d,
      rapidRating: chesscomStats?.chess_rapid?.last?.rating ?? null,
      blitzRating: chesscomStats?.chess_blitz?.last?.rating ?? null,
      puzzlesSolved24h: 0, // Chess.com API складніший для пазлів, поки 0
      puzzleRating: chesscomStats?.tactics?.highest?.rating ?? null,
      homeworkCompletionPct: 0,
      lastActiveLabel: active ? "active_24h" : (chesscomRapid7d + chesscomBlitz7d > 0 ? "active_7d" : "—"),
    });
  }

  // SAVE TO DB
  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    // Guardrail #1: only logged-in coach/admin can write to DB from this endpoint
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const authUser = authData?.user;

    if (authErr || !authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: actorProfile, error: actorProfileErr } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", authUser.id)
      .maybeSingle();

    if (actorProfileErr || !actorProfile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (actorProfile.role !== "coach" && actorProfile.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const actorCoachId = actorProfile.id;

    // One student profile per whole lookup request (lichess + chesscom -> same student_id)
    let targetStudentId: string | null = null;

    // Prefer an existing STUDENT owner if any of the connections already exists
    for (const row of rows) {
      const { data: existingConn } = await supabase
        .from("platform_connections")
        .select("id, user_id")
        .eq("platform", row.platform)
        .eq("platform_username", row.handle)
        .maybeSingle();

      if (!existingConn) continue;

      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("id, role, added_by_coach_id")
        .eq("id", existingConn.user_id)
        .maybeSingle();

      if (ownerProfile?.role === "student") {
        targetStudentId = ownerProfile.id;
        break;
      }
    }

    if (!targetStudentId) {
      targetStudentId = crypto.randomUUID();
    }

    // Create the student profile if missing (do NOT overwrite existing)
    await supabase
      .from("profiles")
      .upsert(
        {
          id: targetStudentId,
          full_name: normalizedUsername,
          role: "student",
          ...(actorProfile.role === "coach" ? { added_by_coach_id: actorCoachId } : {}),
        },
        { onConflict: "id", ignoreDuplicates: true }
      );

    // Re-read target profile to enforce ownership / role
    const { data: targetProfile, error: targetProfileErr } = await supabase
      .from("profiles")
      .select("id, role, added_by_coach_id")
      .eq("id", targetStudentId)
      .maybeSingle();

    if (targetProfileErr || !targetProfile) {
      return NextResponse.json({ error: "Failed to load target profile" }, { status: 500 });
    }

    if (targetProfile.role !== "student") {
      return NextResponse.json(
        { error: "Target profile is not a student (data integrity issue)" },
        { status: 500 }
      );
    }

    // Guardrail #3: coach cannot steal someone else's student; coach can claim orphan
    if (actorProfile.role === "coach") {
      if (targetProfile.added_by_coach_id && targetProfile.added_by_coach_id !== actorCoachId) {
        return NextResponse.json(
          { error: "This student is already linked to another coach" },
          { status: 409 }
        );
      }

      if (!targetProfile.added_by_coach_id) {
        await supabase
          .from("profiles")
          .update({ added_by_coach_id: actorCoachId })
          .eq("id", targetStudentId);
      }
    }

    for (const row of rows) {
      // 1) Check if this (platform, username) is already linked in DB
      const { data: existing, error: existingErr } = await supabase
        .from("platform_connections")
        .select("id, user_id")
        .eq("platform", row.platform)
        .eq("platform_username", row.handle)
        .maybeSingle();

      if (existingErr) {
        console.error("platform_connections lookup error:", existingErr);
        continue;
      }

      if (existing) {
        // Guardrail #2: existing connection must belong to a STUDENT profile
        const { data: ownerProfile, error: ownerErr } = await supabase
          .from("profiles")
          .select("id, role, added_by_coach_id")
          .eq("id", existing.user_id)
          .maybeSingle();

        if (ownerErr) {
          console.error("profiles lookup error:", ownerErr);
          continue;
        }

        if (ownerProfile && ownerProfile.role !== "student") {
          // Misattached connection (e.g., coach/admin) -> move it to student
          await supabase
            .from("platform_connections")
            .update({ user_id: targetStudentId, last_synced_at: nowIso })
            .eq("id", existing.id);
        } else {
          // It is already owned by a student profile
          if (existing.user_id !== targetStudentId) {
            // Do NOT auto-merge two different student profiles
            return NextResponse.json(
              {
                error: `${row.platform} account '${row.handle}' is already linked to a different student`,
              },
              { status: 409 }
            );
          }

          // Update last_synced_at
          await supabase
            .from("platform_connections")
            .update({ last_synced_at: nowIso })
            .eq("id", existing.id);

          // (Optional) claim orphan on the owner student too
          if (actorProfile.role === "coach") {
            const { data: ownerStudent } = await supabase
              .from("profiles")
              .select("id, added_by_coach_id")
              .eq("id", existing.user_id)
              .maybeSingle();

            if (ownerStudent && !ownerStudent.added_by_coach_id) {
              await supabase
                .from("profiles")
                .update({ added_by_coach_id: actorCoachId })
                .eq("id", existing.user_id);
            }
          }
        }
      } else {
        // No existing (platform, username). Ensure target student doesn't already have another username for same platform.
        const { data: existingForStudent } = await supabase
          .from("platform_connections")
          .select("id, platform_username")
          .eq("user_id", targetStudentId)
          .eq("platform", row.platform)
          .maybeSingle();

        if (existingForStudent && existingForStudent.platform_username !== row.handle) {
          return NextResponse.json(
            {
              error: `Student already has a different ${row.platform} connection (${existingForStudent.platform_username}). Resolve manually.`,
            },
            { status: 409 }
          );
        }

        if (!existingForStudent) {
          await supabase.from("platform_connections").insert({
            user_id: targetStudentId,
            platform: row.platform,
            platform_username: row.handle,
            last_synced_at: nowIso,
          });
        } else {
          // Same platform+student exists with same username -> just bump last_synced_at
          await supabase
            .from("platform_connections")
            .update({ last_synced_at: nowIso })
            .eq("id", existingForStudent.id);
        }
      }

      // 2) Insert Snapshot (store stats under the ONE student_id)
      await supabase.from("stats_snapshots").insert({
        user_id: targetStudentId,
        source: row.platform,
        rapid_rating: row.rapidRating,
        blitz_rating: row.blitzRating,
        puzzle_rating: row.puzzleRating,
        rapid_24h: row.rapidGames24h,
        rapid_7d: row.rapidGames7d,
        blitz_24h: row.blitzGames24h,
        blitz_7d: row.blitzGames7d,
        puzzle_24h: row.puzzlesSolved24h,
        puzzle_7d: 0,
        captured_at: nowIso,
      });
    }
  } catch (e) {
    console.error("DB Save error:", e);
  }
  }

  return NextResponse.json({ rows, debug });
}
