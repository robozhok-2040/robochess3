import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function getStudentUserId(request: NextRequest): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) {
      return data.user.id;
    }
  } catch {
    // Fall through to dev fallback when auth/context is unavailable.
  }

  // DEV fallback (env/header) is only allowed outside production.
  if (process.env.NODE_ENV !== "production") {
    const envStudentId = process.env.DEV_STUDENT_ID;
    if (envStudentId) {
      return envStudentId;
    }

    const headerUserId = request.headers.get("x-dev-user-id");
    if (headerUserId) {
      return headerUserId;
    }
  }

  return null;
}

