import { kv } from "@vercel/kv";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_KEYS = new Set(["settings", "progress"]);
const MAX_BODY_BYTES = 512_000; // 500 KB safety cap

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json(
      { error: "Invalid key" },
      { status: 400 },
    );
  }

  if (!hasKvConfig()) {
    return NextResponse.json(
      { error: "KV not configured" },
      { status: 503 },
    );
  }

  const value = await kv.get(`aispb:${key}`);

  return NextResponse.json({ key, value: value ?? null });
}

export async function PUT(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key || !ALLOWED_KEYS.has(key)) {
    return NextResponse.json(
      { error: "Invalid key" },
      { status: 400 },
    );
  }

  if (!hasKvConfig()) {
    return NextResponse.json(
      { error: "KV not configured" },
      { status: 503 },
    );
  }

  const contentLength = request.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 },
    );
  }

  const body = (await request.json()) as { value: unknown };

  if (!body || typeof body !== "object" || !("value" in body)) {
    return NextResponse.json(
      { error: "Body must be { value: ... }" },
      { status: 400 },
    );
  }

  await kv.set(`aispb:${key}`, body.value);

  return NextResponse.json({ ok: true });
}
