import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { parseStudentId, getActorCoach } from "@/lib/server/devBypass";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idFromParams } = await params;
    const searchParams = request.nextUrl.searchParams;
    const platform = searchParams.get('platform') as 'lichess' | 'chesscom' | null;

    // Parse student ID (handle composite keys like "studentId:platform")
    const studentId = parseStudentId(idFromParams);
    if (!studentId) {
      console.error(`[DELETE student] Invalid studentId format: ${idFromParams}`);
      return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
    }

    if (!platform || (platform !== 'lichess' && platform !== 'chesscom')) {
      return NextResponse.json({ error: "Missing or invalid platform parameter (must be 'lichess' or 'chesscom')" }, { status: 400 });
    }

    const supabase = await createClient();

    // Resolve actor (coach/admin) - unified helper handles auth + dev bypass
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
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    // Ownership check: coach can only remove students they added
    if (actorRole === 'coach' && student.added_by_coach_id !== actorCoachId) {
      return NextResponse.json(
        { error: "Student not found (or not owned by this coach)" },
        { status: 404 }
      );
    }

    // Verify platform connection exists and belongs to this student
    const connection = await prisma.platform_connections.findFirst({
      where: {
        user_id: studentId,
        platform: platform,
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "Platform connection not found" },
        { status: 404 }
      );
    }

    // Delete only this specific platform connection
    await prisma.platform_connections.delete({
      where: {
        id: connection.id,
      },
    });

    // Check if student has any remaining platform connections
    const remainingConnections = await prisma.platform_connections.count({
      where: {
        user_id: studentId,
      },
    });

    // If no more connections, detach student from coach (soft remove)
    if (remainingConnections === 0) {
      await prisma.profiles.update({
        where: {
          id: studentId,
        },
        data: {
          added_by_coach_id: null,
        },
      });
    }

    console.log(`[DELETE student] Successfully removed platform connection: studentId=${studentId}, platform=${platform} by actor: ${actorCoachId}`);
    return NextResponse.json({ ok: true, removedStudentId: studentId, platform });
  } catch (error: any) {
    console.error("Error removing student:", error);
    
    return NextResponse.json({ 
      error: "Internal Server Error",
      details: error.message 
    }, { status: 500 });
  }
}

