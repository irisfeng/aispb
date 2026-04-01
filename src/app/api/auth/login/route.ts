import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

// Simple in-memory rate limiter: max 5 failed attempts per nickname per 15 minutes
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now > entry.resetAt) return true;
  return entry.count < MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearFailures(key: string) {
  failedAttempts.delete(key);
}

export async function POST(request: Request) {
  try {
    const { nickname, pin } = await request.json();

    if (!nickname || !pin) {
      return NextResponse.json(
        { error: "Nickname and PIN are required" },
        { status: 400 },
      );
    }

    const normalizedNickname = nickname.toLowerCase().replace(/[^a-z0-9]/g, "");
    const email = `${normalizedNickname}@aispb.local`;

    // Rate limit check
    if (!checkRateLimit(normalizedNickname)) {
      return NextResponse.json(
        { error: "Too many failed attempts. Please try again later." },
        { status: 429 },
      );
    }

    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (error) {
      recordFailure(normalizedNickname);
      return NextResponse.json(
        { error: "Invalid nickname or PIN" },
        { status: 401 },
      );
    }

    clearFailures(normalizedNickname);

    return NextResponse.json({
      user: {
        id: data.user?.id,
        nickname: data.user?.user_metadata?.nickname ?? nickname,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
