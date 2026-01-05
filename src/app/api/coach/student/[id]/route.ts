import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseStudentId, getActorCoach, normalizePlatform } from "@/lib/server/devBypass";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const platformInput = searchParams.get('platform');

    // Parse and validate student ID (must be UUID)
    const studentId = parseStudentId(id);
    if (!studentId) {
      console.error(`[DELETE student] Invalid studentId format: ${id}`);
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }

    // Normalize platform to canonical value
    const platform = normalizePlatform(platformInput);
    if (!platform) {
      return NextResponse.json({ 
        error: "Missing or invalid platform parameter (must be 'lichess' or 'chesscom')" 
      }, { status: 400 });
    }

    const supabase = await createClient();

    // Resolve actor (coach/admin) - unified helper handles auth + dev bypass
    // This ensures DELETE uses the SAME coach context as GET /api/coach/students
    let actorCoachId: string;
    let actorRole: 'coach' | 'admin';
    try {
      const actor = await getActorCoach(request, supabase);
      actorCoachId = actor.actorCoachId;
      actorRole = actor.actorRole;
      console.log(`[DELETE student] Actor resolved: id=${actorCoachId}, role=${actorRole}, mode=${actor.mode}, studentId=${studentId}, platform=${platform}`);
    } catch (err: any) {
      console.error(`[DELETE student] Actor resolution failed:`, err);
      return NextResponse.json({ error: err.error || "Unauthorized" }, { status: err.status || 401 });
    }

    // Verify student exists and check ownership
    const student = await prisma.profiles.findFirst({
      where: {
        id: studentId,
        role: 'student',
      },
      select: {
        id: true,
        added_by_coach_id: true,
      },
    });

    if (!student) {
      // Return 200 with removed:0 for idempotency (student doesn't exist, so deletion already complete)
      return NextResponse.json({ 
        ok: true, 
        removed: 0, 
        note: 'Student not found (may have been already removed)' 
      });
    }

    // Ownership check: coach can only remove students they added
    if (actorRole === 'coach' && student.added_by_coach_id !== actorCoachId) {
      // Return 200 with removed:0 for idempotency (not owned, so deletion already complete from coach's perspective)
      return NextResponse.json({ 
        ok: true, 
        removed: 0, 
        note: 'Student not found or not owned by this coach' 
      });
    }

    // Delete platform connection using deleteMany for idempotency
    // This returns a count, so we can handle "already deleted" gracefully
    const deleteResult = await prisma.platform_connections.deleteMany({
      where: {
        user_id: studentId,
        platform: platform, // Use normalized canonical platform
      },
    });

    const removedCount = deleteResult.count;

    // Check if student has any remaining platform connections
    const remainingConnections = await prisma.platform_connections.count({
      where: {
        user_id: studentId,
      },
    });

    // If no more connections, detach student from coach (soft remove)
    if (remainingConnections === 0 && removedCount > 0) {
      await prisma.profiles.update({
        where: {
          id: studentId,
        },
        data: {
          added_by_coach_id: null,
        },
      });
    }

    console.log(`[DELETE student] Idempotent delete result: studentId=${studentId}, platform=${platform}, removed=${removedCount} by actor: ${actorCoachId}`);
    
    // Always return 200 with ok:true for idempotency
    // If removedCount === 0, connection was already deleted (idempotent success)
    return NextResponse.json({ 
      ok: true, 
      removed: removedCount,
      removedStudentId: studentId, 
      platform 
    });
  } catch (error: any) {
    console.error("Error removing student:", error);
    
    return NextResponse.json({ 
      error: "Internal Server Error",
      details: error.message 
    }, { status: 500 });
  }
}
