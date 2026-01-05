import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canUseDevBypass, extractHostname } from "@/lib/server/devBypass";

export const dynamic = 'force-dynamic';

/**
 * GET /api/dev/coach-list
 * Returns list of coach/admin profiles for local development UI selection
 * 
 * Security: Only available in development on localhost
 */
export async function GET(request: NextRequest) {
  // Dev-only guard: only allow in development on localhost
  const hostname = extractHostname(request);
  if (!canUseDevBypass({ nodeEnv: process.env.NODE_ENV, hostname })) {
    // Return 404 (not 403) to avoid leaking that this endpoint exists
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // Fetch coach and admin profiles
    const coaches = await prisma.profiles.findMany({
      where: {
        role: {
          in: ['coach', 'admin'],
        },
      },
      select: {
        id: true,
        username: true,
        full_name: true,
        email: true,
        role: true,
      },
      orderBy: [
        { role: 'asc' }, // admin first, then coach
        { username: 'asc' },
      ],
    });

    return NextResponse.json({
      coaches: coaches.map((coach) => ({
        id: coach.id,
        username: coach.username,
        full_name: coach.full_name,
        email: coach.email,
        role: coach.role,
      })),
    });
  } catch (error) {
    console.error('[DEV coach-list] Error fetching coaches:', error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
