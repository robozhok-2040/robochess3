import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/utils/supabase/server';

import { prisma } from '@/lib/prisma';

import { encryptToken } from '@/lib/security/tokenEncryption';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

/**
 * GET: Check if current user has a Lichess token stored
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const connection = await prisma.platform_connections.findUnique({
      where: {
        user_id_platform: {
          user_id: user.id,
          platform: 'lichess',
        },
      },
      select: {
        lichess_oauth_token_encrypted: true,
      },
    });

    return NextResponse.json({
      hasToken:
        connection?.lichess_oauth_token_encrypted !== null &&
        connection?.lichess_oauth_token_encrypted !== undefined,
    });
  } catch (error) {
    console.error('Error checking Lichess token:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST: Save encrypted Lichess token for current user
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { token } = body;

    // Validate token
    if (typeof token !== 'string' || token.trim().length === 0) {
      return NextResponse.json({ error: 'token must be a non-empty string' }, { status: 400 });
    }

    // Encrypt token
    const encryptedToken = encryptToken(token);

    // Upsert platform_connections record
    await prisma.platform_connections.upsert({
      where: {
        user_id_platform: {
          user_id: user.id,
          platform: 'lichess',
        },
      },
      update: {
        lichess_oauth_token_encrypted: encryptedToken,
      },
      create: {
        user_id: user.id,
        platform: 'lichess',
        platform_username: 'UNKNOWN',
        lichess_oauth_token_encrypted: encryptedToken,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error saving Lichess token:', error);

    if (error instanceof Error && error.message.includes('LICHESS_ENCRYPTION_KEY')) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

