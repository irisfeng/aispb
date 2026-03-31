import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { nickname, pin } = await request.json();

    if (!nickname || !pin) {
      return NextResponse.json(
        { error: "Nickname and PIN are required" },
        { status: 400 },
      );
    }

    const email = `${nickname.toLowerCase().replace(/[^a-z0-9]/g, "")}@aispb.local`;

    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pin,
    });

    if (error) {
      return NextResponse.json(
        { error: "Invalid nickname or PIN" },
        { status: 401 },
      );
    }

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
