/**
 * iFlytek (科大讯飞) Online TTS (在线语音合成)
 *
 * WebSocket API that synthesizes speech from text.
 *
 * Endpoints:
 *   - Domestic: tts-api.xfyun.cn
 *   - Global:   tts-api-sg.xf-yun.com (Singapore, <100ms to Tokyo)
 *
 * Docs: https://global.xfyun.cn/doc/tts/online_tts/API.html
 *
 * Shares credentials with iFlytek ASR:
 *   IFLYTEK_APP_ID       — Application ID
 *   IFLYTEK_API_KEY      — API Key
 *   IFLYTEK_API_SECRET   — API Secret
 *   IFLYTEK_REGION       — "global" for Singapore endpoint
 */

import { createHmac } from "node:crypto";
import WebSocket from "ws";

/** Domestic (China) endpoint */
const WS_HOST_DOMESTIC = "tts-api.xfyun.cn";
/** Global (Singapore) endpoint */
const WS_HOST_GLOBAL = "tts-api-sg.xf-yun.com";
const WS_PATH = "/v2/tts";

const DEFAULT_SPEAKER = "x_Catherine";
const DEFAULT_SAMPLE_RATE = 16000;
const PROVIDER_LABEL = "iFlytek Online TTS";

function getAppId() {
  return process.env.IFLYTEK_APP_ID?.trim() || "";
}

function getApiKey() {
  return process.env.IFLYTEK_API_KEY?.trim() || "";
}

function getApiSecret() {
  return process.env.IFLYTEK_API_SECRET?.trim() || "";
}

function getWsHost(): string {
  const region = process.env.IFLYTEK_REGION?.trim().toLowerCase();
  return region === "global" ? WS_HOST_GLOBAL : WS_HOST_DOMESTIC;
}

function getSpeaker(): string {
  return process.env.IFLYTEK_TTS_SPEAKER?.trim() || DEFAULT_SPEAKER;
}

export function hasIflytekTtsConfig(): boolean {
  return Boolean(getAppId() && getApiKey() && getApiSecret());
}

/**
 * Build the authenticated WebSocket URL with HMAC-SHA256 signature.
 * Same auth method as the ASR API.
 */
function buildAuthUrl(): string {
  const wsHost = getWsHost();
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${wsHost}\ndate: ${date}\nGET ${WS_PATH} HTTP/1.1`;

  const signature = createHmac("sha256", getApiSecret())
    .update(signatureOrigin)
    .digest("base64");

  const authorizationOrigin = [
    `api_key="${getApiKey()}"`,
    `algorithm="hmac-sha256"`,
    `headers="host date request-line"`,
    `signature="${signature}"`,
  ].join(", ");

  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  const params = new URLSearchParams({
    authorization,
    date,
    host: wsHost,
  });

  return `wss://${wsHost}${WS_PATH}?${params.toString()}`;
}

// ---- Response types ---------------------------------------------------------

interface IflytekTtsResponse {
  code: number;
  message: string;
  sid?: string;
  data?: {
    audio?: string; // base64-encoded audio chunk
    status: number; // 0=start, 1=proceeding, 2=end
    ced?: string; // synthesis progress
  };
}

// ---- Result type ------------------------------------------------------------

export interface IflytekTtsResult {
  audioBuffer: Buffer;
  contentType: string;
  provider: string;
  speaker: string;
  durationSeconds: number | null;
}

// ---- Main synthesis function ------------------------------------------------

/**
 * Synthesize speech from text using iFlytek Online TTS.
 *
 * Opens a WebSocket, sends the text, collects all audio chunks,
 * and returns a WAV buffer.
 */
export async function synthesizeWithIflytekTts(
  text: string,
): Promise<IflytekTtsResult> {
  if (!hasIflytekTtsConfig()) {
    throw new Error("iFlytek TTS is not configured.");
  }

  const speaker = getSpeaker();
  const wsUrl = buildAuthUrl();

  return new Promise<IflytekTtsResult>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const audioChunks: Buffer[] = [];
    let connectionTimeout: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
    }

    // 15s connection timeout
    connectionTimeout = setTimeout(() => {
      cleanup();
      ws.close();
      reject(new Error("iFlytek TTS connection timed out."));
    }, 15_000);

    ws.on("error", (error: Error) => {
      cleanup();
      reject(error);
    });

    ws.on("open", () => {
      // Send entire text in a single frame (status = 2)
      const frame = {
        common: { app_id: getAppId() },
        business: {
          aue: "raw", // PCM output
          auf: `audio/L16;rate=${DEFAULT_SAMPLE_RATE}`,
          vcn: speaker,
          speed: 50,
          volume: 50,
          pitch: 50,
          tte: "UTF8",
        },
        data: {
          text: Buffer.from(text, "utf-8").toString("base64"),
          status: 2, // single-frame transmission
        },
      };

      ws.send(JSON.stringify(frame));
    });

    ws.on("message", (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      let response: IflytekTtsResponse;
      try {
        response = JSON.parse(raw) as IflytekTtsResponse;
      } catch {
        return;
      }

      if (response.code !== 0) {
        cleanup();
        ws.close();
        reject(
          new Error(
            `iFlytek TTS error ${response.code}: ${response.message}`,
          ),
        );
        return;
      }

      // Collect audio chunk
      if (response.data?.audio) {
        audioChunks.push(Buffer.from(response.data.audio, "base64"));
      }

      // status === 2 means synthesis complete
      if (response.data?.status === 2) {
        cleanup();
        ws.close();

        const pcmBuffer = Buffer.concat(audioChunks);
        const wavBuffer = wrapPcmAsWav(pcmBuffer, DEFAULT_SAMPLE_RATE);

        // Estimate duration from PCM length
        const bytesPerSecond = DEFAULT_SAMPLE_RATE * 2; // 16-bit mono
        const durationSeconds =
          pcmBuffer.length > 0
            ? Math.round((pcmBuffer.length / bytesPerSecond) * 100) / 100
            : null;

        resolve({
          audioBuffer: wavBuffer,
          contentType: "audio/wav",
          provider: PROVIDER_LABEL,
          speaker,
          durationSeconds,
        });
      }
    });

    ws.on("close", () => {
      cleanup();
      // If we haven't resolved yet, assemble what we have
      if (audioChunks.length > 0) {
        const pcmBuffer = Buffer.concat(audioChunks);
        const wavBuffer = wrapPcmAsWav(pcmBuffer, DEFAULT_SAMPLE_RATE);
        const bytesPerSecond = DEFAULT_SAMPLE_RATE * 2;
        const durationSeconds =
          Math.round((pcmBuffer.length / bytesPerSecond) * 100) / 100;

        resolve({
          audioBuffer: wavBuffer,
          contentType: "audio/wav",
          provider: PROVIDER_LABEL,
          speaker,
          durationSeconds,
        });
      } else {
        reject(new Error("iFlytek TTS connection closed without audio data."));
      }
    });
  });
}

// ---- WAV helper -------------------------------------------------------------

function wrapPcmAsWav(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}
