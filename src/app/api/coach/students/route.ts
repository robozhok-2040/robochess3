import { NextResponse } from "next/server";

export async function GET() {
  // TODO: Replace in-memory store with Supabase DB persistence
  // TODO: Fetch students from Supabase database
  // TODO: Filter by coach/user context when auth is added

  return NextResponse.json({ ok: true });
}

export async function POST() {
  // TODO: Replace in-memory store with Supabase DB persistence
  // TODO: Insert new student into Supabase database
  // TODO: Validate coach/user context when auth is added

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  // TODO: Replace in-memory store with Supabase DB persistence
  // TODO: Delete student from Supabase database
  // TODO: Validate coach/user context when auth is added

  return NextResponse.json({ ok: true });
}

