import { createClient } from "@/utils/supabase/server";

export async function getCoachUserId(request: Request): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { getActorCoach } = await import("@/lib/server/devBypass");
    const actor = await getActorCoach(request as any, supabase);
    if (actor?.actorCoachId) {
      return actor.actorCoachId;
    }
  } catch {
    // Fall through to dev fallback when auth/context is unavailable.
  }

  if (process.env.NODE_ENV !== "production") {
    const envCoachId = process.env.DEV_COACH_ID;
    if (envCoachId) {
      return envCoachId;
    }

    const headerCoachId = request.headers.get("x-dev-coach-id");
    if (headerCoachId) {
      return headerCoachId;
    }
  }

  return null;
}


