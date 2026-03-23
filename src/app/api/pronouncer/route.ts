import { NextResponse } from "next/server";

import {
  getPronouncerErrorPayload,
  getPronouncerProviderStatus,
  hasVolcengineSpeechConfig,
  synthesizeWithVolcengineSpeech,
} from "@/lib/volcengine-speech";

export const runtime = "nodejs";

interface PronouncerRequestBody {
  text?: string;
}

export async function GET() {
  return NextResponse.json(getPronouncerProviderStatus());
}

export async function POST(request: Request) {
  let body: PronouncerRequestBody;

  try {
    body = (await request.json()) as PronouncerRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const text = body.text?.trim();

  if (!text) {
    return NextResponse.json(
      { error: "Missing text for pronouncer synthesis." },
      { status: 400 },
    );
  }

  if (!hasVolcengineSpeechConfig()) {
    const status = getPronouncerProviderStatus();

    return NextResponse.json(
      {
        detail: status.detail,
        error: "Pronouncer provider is not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await synthesizeWithVolcengineSpeech(text);
    const audioBytes = new Uint8Array(result.audioBuffer);

    return new NextResponse(audioBytes, {
      headers: {
        "content-type": result.contentType,
        "cache-control": "no-store",
        "x-aispb-provider": result.provider,
        "x-aispb-speaker": result.speaker,
        "x-aispb-duration-seconds":
          result.durationSeconds === null ? "" : String(result.durationSeconds),
      },
    });
  } catch (error) {
    console.error("pronouncer synthesis failed", error);

    const errorPayload = getPronouncerErrorPayload(error);

    return NextResponse.json(
      {
        detail: errorPayload.detail,
        error: errorPayload.error,
      },
      { status: errorPayload.statusCode },
    );
  }
}
