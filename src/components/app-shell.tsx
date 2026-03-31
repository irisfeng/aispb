"use client";

import { useEffect, useState } from "react";
import { AispbApp } from "@/components/aispb-app";
import { AuthScreen } from "@/components/auth-screen";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface AuthUser {
  id: string;
  nickname: string;
}

const supabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function AppShell() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(!supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;

    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setAuthUser({
          id: user.id,
          nickname: user.user_metadata?.nickname ?? "User",
        });
      }
      setAuthChecked(true);
    });
  }, []);

  // Not yet checked — show nothing (avoids flash)
  if (!authChecked) return null;

  // Supabase configured but not logged in — show auth screen
  if (supabaseConfigured && !authUser) {
    return (
      <AuthScreen
        onAuthSuccess={(user) => setAuthUser(user)}
      />
    );
  }

  // Logged in (or Supabase not configured) — show main app
  return (
    <AispbApp
      authUser={authUser ?? undefined}
      onSignOut={() => setAuthUser(null)}
    />
  );
}
