import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getVoiceTurnProviderStatus,
  interpretVoiceTurnFromAudio,
  interpretVoiceTurnFromPcm,
  interpretVoiceTurnFromTranscript,
} from "@/lib/voice-turn";

export const runtime = "nodejs";

const MAX_TRANSCRIPT_LENGTH = 1000;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10 MB

interface VoiceTurnRequestBody {
  transcript?: string;
}

export async function GET() {
  return NextResponse.json(getVoiceTurnProviderStatus());
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: "Request body too large." },
      { status: 413 },
    );
  }

  try {
    // PCM 16kHz mono binary from client-side AudioContext conversion
    const format = request.nextUrl.searchParams.get("format");
    if (format === "pcm16k" && contentType.includes("application/octet-stream")) {
      const pcmBuffer = Buffer.from(await request.arrayBuffer());

      if (pcmBuffer.length === 0) {
        return NextResponse.json(
          { error: "Empty PCM audio buffer." },
          { status: 400 },
        );
      }

      if (pcmBuffer.length > MAX_AUDIO_SIZE) {
        return NextResponse.json(
          { error: `Audio exceeds maximum size of ${MAX_AUDIO_SIZE / (1024 * 1024)} MB.` },
          { status: 413 },
        );
      }

      return NextResponse.json(await interpretVoiceTurnFromPcm(pcmBuffer));
    }

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as VoiceTurnRequestBody;

      if (body.transcript !== undefined && typeof body.transcript !== "string") {
        return NextResponse.json(
          { error: "Field 'transcript' must be a string." },
          { status: 400 },
        );
      }

      const transcript = body.transcript?.trim() || "";

      if (!transcript) {
        return NextResponse.json(
          { error: "Missing transcript for voice turn." },
          { status: 400 },
        );
      }

      if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
        return NextResponse.json(
          { error: `Transcript exceeds maximum length of ${MAX_TRANSCRIPT_LENGTH} characters.` },
          { status: 400 },
        );
      }

      return NextResponse.json(
        await interpretVoiceTurnFromTranscript(transcript),
      );
    }

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const audioFile = formData.get("audio");

      if (!(audioFile instanceof File)) {
        return NextResponse.json(
          { error: "Missing audio file for voice turn." },
          { status: 400 },
        );
      }

      if (audioFile.size > MAX_AUDIO_SIZE) {
        return NextResponse.json(
          { error: `Audio file exceeds maximum size of ${MAX_AUDIO_SIZE / (1024 * 1024)} MB.` },
          { status: 413 },
        );
      }

      const contentTypeHeader =
        audioFile.type || "audio/webm";

      return NextResponse.json(
        await interpretVoiceTurnFromAudio({
          audioBuffer: await audioFile.arrayBuffer(),
          contentType: contentTypeHeader,
          filename: "voice-turn",
        }),
      );
    }
  } catch (error) {
    console.error("voice turn failed", error);

    return NextResponse.json(
      { error: "Voice turn processing failed." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { error: "Unsupported voice turn request." },
    { status: 415 },
  );
}
