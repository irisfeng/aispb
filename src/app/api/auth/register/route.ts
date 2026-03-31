import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const { nickname, pin, inviteCode } = await request.json();

    // Validate invite code
    const validCode = process.env.INVITE_CODE;
    if (!validCode || inviteCode !== validCode) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 403 },
      );
    }

    // Validate inputs
    if (
      !nickname ||
      typeof nickname !== "string" ||
      nickname.length < 2 ||
      nickname.length > 20
    ) {
      return NextResponse.json(
        { error: "Nickname must be 2-20 characters" },
        { status: 400 },
      );
    }

    if (
      !pin ||
      typeof pin !== "string" ||
      !/^\d{4,6}$/.test(pin)
    ) {
      return NextResponse.json(
        { error: "PIN must be 4-6 digits" },
        { status: 400 },
      );
    }

    const email = `${nickname.toLowerCase().replace(/[^a-z0-9]/g, "")}@aispb.local`;

    const supabase = await createSupabaseAdminClient();

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { nickname },
    });

    if (error) {
      if (error.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "This nickname is already taken" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Insert default settings for the new user
    if (data.user) {
      await supabase.from("user_settings").insert({
        user_id: data.user.id,
      });
    }

    // Sign in the newly created user
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password: pin,
      });

    if (signInError) {
      return NextResponse.json(
        { error: "Account created but sign-in failed. Please log in manually." },
        { status: 201 },
      );
    }

    return NextResponse.json({
      user: {
        id: signInData.user?.id,
        nickname: signInData.user?.user_metadata?.nickname ?? nickname,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
