import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type LichessUser = {
  perfs?: {
    rapid?: { rating?: number };
    blitz?: { rating?: number };
    puzzle?: { rating?: number; games?: number };
  };
};

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // 1. Fetch all student profiles with their platform connections
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, platform_connections(platform, platform_username)")
      .eq("role", "student");

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      return NextResponse.json(
        { error: "Failed to fetch profiles", details: profilesError.message },
        { status: 500 }
      );
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No students found",
        processed: 0,
        succeeded: 0,
        failed: 0,
      });
    }

    // Filter profiles that have Lichess connections
    const lichessProfiles = profiles
      .map((profile: any) => {
        const platformConnections = profile.platform_connections || [];
        const lichessConn = platformConnections.find(
          (conn: any) => conn.platform === "lichess"
        );
        if (lichessConn && lichessConn.platform_username) {
          return {
            id: profile.id,
            username: lichessConn.platform_username,
          };
        }
        return null;
      })
      .filter((p: any) => p !== null);

    console.log(`[UPDATE-STATS] Found ${lichessProfiles.length} students with Lichess accounts`);

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    // 2. Process each student with rate limiting
    for (const profile of lichessProfiles) {
      if (!profile || !profile.username) continue;
      try {
        // Fetch Lichess data
        const response = await fetch(
          `https://lichess.org/api/user/${encodeURIComponent(profile.username)}`,
          {
            headers: { Accept: "application/json" },
          }
        );

        if (!response.ok) {
          throw new Error(`Lichess API returned ${response.status}`);
        }

        const lichessData: LichessUser = await response.json();

        // Extract stats
        const puzzleTotal = lichessData.perfs?.puzzle?.games ?? 0;
        const puzzleRating = lichessData.perfs?.puzzle?.rating ?? null;
        const rapidRating = lichessData.perfs?.rapid?.rating ?? null;
        const blitzRating = lichessData.perfs?.blitz?.rating ?? null;

        // Insert snapshot
        const { error: insertError } = await supabase
          .from("stats_snapshots")
          .insert({
            user_id: profile.id,
            source: "lichess",
            rating_rapid: rapidRating,
            rating_blitz: blitzRating,
            puzzle_rating: puzzleRating,
            puzzle_total: puzzleTotal,
            captured_at: new Date().toISOString(),
          });

        if (insertError) {
          throw new Error(`Database insert failed: ${insertError.message}`);
        }

        succeeded++;
        console.log(
          `[UPDATE-STATS] ✅ Saved snapshot for ${profile.username} (${profile.id}): ${puzzleTotal} puzzles`
        );

        // Rate limiting: 1000ms delay between requests
        if (profile !== lichessProfiles[lichessProfiles.length - 1]) {
          await delay(1000);
        }
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${profile.username}: ${errorMsg}`);
        console.error(`[UPDATE-STATS] ❌ Failed for ${profile.username}:`, errorMsg);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${lichessProfiles.length} students`,
      processed: lichessProfiles.length,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[UPDATE-STATS] Fatal error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

