import { NextResponse } from "next/server";

import {
  hasIflytekTtsConfig,
  synthesizeWithIflytekTts,
} from "@/lib/iflytek-tts";
import {
  getPronouncerErrorPayload,
  getPronouncerProviderStatus,
  hasVolcengineSpeechConfig,
  synthesizeWithVolcengineSpeech,
} from "@/lib/volcengine-speech";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 500;
const MAX_CONTENT_LENGTH = 10 * 1024; // 10 KB

interface PronouncerRequestBody {
  text?: string;
}

function hasAnyTtsConfig(): boolean {
  return hasVolcengineSpeechConfig() || hasIflytekTtsConfig();
}

export async function GET() {
  const status = getPronouncerProviderStatus();

  // Augment status if iFlytek TTS is available as fallback
  if (!hasVolcengineSpeechConfig() && hasIflytekTtsConfig()) {
    return NextResponse.json({
      ...status,
      configured: true,
      detail: "iFlytek Online TTS is active.",
      provider: "iFlytek Online TTS",
    });
  }

  return NextResponse.json(status);
}

/**
 * Build a binary audio response from a synthesis result.
 */
function audioResponse(result: {
  audioBuffer: Buffer;
  contentType: string;
  provider: string;
  speaker: string;
  durationSeconds: number | null;
}) {
  return new NextResponse(new Uint8Array(result.audioBuffer), {
    headers: {
      "content-type": result.contentType,
      "cache-control": "no-store",
      "x-aispb-provider": result.provider,
      "x-aispb-speaker": result.speaker,
      "x-aispb-duration-seconds":
        result.durationSeconds === null
          ? ""
          : String(result.durationSeconds),
    },
  });
}

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: "Request body too large." },
      { status: 413 },
    );
  }

  let body: PronouncerRequestBody;

  try {
    body = (await request.json()) as PronouncerRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (body.text !== undefined && typeof body.text !== "string") {
    return NextResponse.json(
      { error: "Field 'text' must be a string." },
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

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  if (!hasAnyTtsConfig()) {
    return NextResponse.json(
      {
        detail: "No TTS provider configured. Add Volcengine or iFlytek credentials.",
        error: "Pronouncer provider is not configured.",
      },
      { status: 503 },
    );
  }

  // Try Volcengine first, fall back to iFlytek
  if (hasVolcengineSpeechConfig()) {
    try {
      const result = await synthesizeWithVolcengineSpeech(text);
      return audioResponse(result);
    } catch (error) {
      console.error("volcengine tts failed, trying iflytek fallback", error);
      // Fall through to iFlytek
    }
  }

  // iFlytek TTS
  if (hasIflytekTtsConfig()) {
    try {
      const result = await synthesizeWithIflytekTts(text);
      return audioResponse(result);
    } catch (error) {
      console.error("iflytek tts failed", error);

      return NextResponse.json(
        {
          detail: error instanceof Error ? error.message : "Unknown error",
          error: "iFlytek TTS synthesis failed.",
        },
        { status: 502 },
      );
    }
  }

  const errorPayload = getPronouncerErrorPayload(
    new Error("All TTS providers failed."),
  );

  return NextResponse.json(
    { detail: errorPayload.detail, error: errorPayload.error },
    { status: errorPayload.statusCode },
  );
}
