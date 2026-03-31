"use client";

import { useState } from "react";

interface AuthUser {
  id: string;
  nickname: string;
}

interface AuthScreenProps {
  onAuthSuccess: (user: AuthUser) => void;
}

export function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login"
        ? { nickname, pin }
        : { nickname, pin, inviteCode };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      onAuthSuccess(data.user);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-4 py-8">
      <div className="w-full rounded-[28px] border border-[color:var(--line)] bg-white/72 p-6 shadow-[0_24px_80px_rgba(17,32,51,0.10)] backdrop-blur-xl sm:p-8">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--muted)]">
            AISPB
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-fraunces)] text-2xl text-[color:var(--foreground)]">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-semibold text-[color:var(--foreground)]">
              Nickname
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Emma"
              autoComplete="username"
              className="mt-1.5 w-full rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3 text-base text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
              required
              minLength={2}
              maxLength={20}
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-[color:var(--foreground)]">
              PIN
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="4-6 digits"
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3 text-base text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
              required
              minLength={4}
              maxLength={6}
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="text-sm font-semibold text-[color:var(--foreground)]">
                Invite code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Enter invite code"
                className="mt-1.5 w-full rounded-2xl border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3 text-base text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
                required
              />
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-[color:var(--signal)]/10 px-4 py-2.5 text-sm font-medium text-[color:var(--signal)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="primary-button w-full justify-center"
          >
            {loading
              ? "..."
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-[color:var(--muted)]">
          {mode === "login" ? (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => { setMode("register"); setError(null); }}
                className="font-semibold text-[color:var(--accent)] hover:underline"
              >
                Create account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="font-semibold text-[color:var(--accent)] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
