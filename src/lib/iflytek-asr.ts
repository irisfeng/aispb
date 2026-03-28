/**
 * iFlytek (科大讯飞) Streaming Speech Dictation (语音听写流式版)
 *
 * WebSocket API that transcribes audio in real-time.
 * Docs: https://www.xfyun.cn/doc/asr/voicedictation/API.html
 *
 * Env vars:
 *   IFLYTEK_APP_ID       — Application ID
 *   IFLYTEK_API_KEY      — API Key
 *   IFLYTEK_API_SECRET   — API Secret
 */

import { createHmac } from "node:crypto";
import WebSocket from "ws";

const WS_HOST = "iat-api.xfyun.cn";
const WS_PATH = "/v2/iat";

// PCM 16kHz mono, 40ms per frame = 1280 bytes
const FRAME_SIZE = 1280;
const FRAME_INTERVAL_MS = 40;

export function hasIflytekAsrConfig(): boolean {
  return Boolean(
    getAppId() && getApiKey() && getApiSecret(),
  );
}

function getAppId() {
  return process.env.IFLYTEK_APP_ID?.trim() || "";
}

function getApiKey() {
  return process.env.IFLYTEK_API_KEY?.trim() || "";
}

function getApiSecret() {
  return process.env.IFLYTEK_API_SECRET?.trim() || "";
}

/**
 * Build the authenticated WebSocket URL with HMAC-SHA256 signature.
 */
function buildAuthUrl(): string {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${WS_HOST}\ndate: ${date}\nGET ${WS_PATH} HTTP/1.1`;

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
    host: WS_HOST,
  });

  return `wss://${WS_HOST}${WS_PATH}?${params.toString()}`;
}

// ---- Response parsing -------------------------------------------------------

interface IflytekWord {
  w: string;
  sc: number;
}

interface IflytekWs {
  cw: IflytekWord[];
}

interface IflytekResult {
  sn: number;
  ls: boolean;
  ws: IflytekWs[];
  pgs?: "apd" | "rpl";
  rg?: [number, number];
}

interface IflytekResponse {
  code: number;
  message: string;
  sid: string;
  data?: {
    status: number;
    result?: IflytekResult;
  };
}

/**
 * Extract text from an iFlytek result segment.
 */
function extractResultText(result: IflytekResult): string {
  return result.ws
    .flatMap((ws) => ws.cw.map((cw) => cw.w))
    .join("");
}

// ---- Main transcription function --------------------------------------------

/**
 * Transcribe a PCM 16kHz mono audio buffer using iFlytek streaming ASR.
 *
 * The function opens a WebSocket, streams audio frames at 40ms intervals,
 * collects all result segments, and returns the final transcript.
 */
export async function transcribeWithIflytek(
  pcmBuffer: Buffer,
  options: { language?: string } = {},
): Promise<string> {
  if (!hasIflytekAsrConfig()) {
    throw new Error("iFlytek ASR is not configured.");
  }

  const language = options.language ?? "en_us";
  const wsUrl = buildAuthUrl();

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const resultSegments: Map<number, string> = new Map();
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
      reject(new Error("iFlytek ASR connection timed out."));
    }, 15_000);

    ws.on("error", (error: Error) => {
      cleanup();
      reject(error);
    });

    ws.on("open", () => {
      // Stream audio frames
      let offset = 0;
      let frameIndex = 0;

      function sendNextFrame() {
        if (ws.readyState !== ws.OPEN) {
          return;
        }

        const isFirst = frameIndex === 0;
        const remaining = pcmBuffer.length - offset;
        const chunkSize = Math.min(FRAME_SIZE, remaining);
        const isLast = offset + chunkSize >= pcmBuffer.length;

        const status = isLast ? 2 : isFirst ? 0 : 1;
        const audioChunk = pcmBuffer.subarray(offset, offset + chunkSize);

        const frame: Record<string, unknown> = {
          data: {
            status,
            format: "audio/L16;rate=16000",
            encoding: "raw",
            audio: audioChunk.toString("base64"),
          },
        };

        if (isFirst) {
          frame.common = { app_id: getAppId() };
          frame.business = {
            language,
            domain: "iat",
            accent: "mandarin",
            ptt: 0, // disable auto punctuation for letter spelling
            vad_eos: 3000, // 3s end-of-speech timeout
          };
        }

        ws.send(JSON.stringify(frame));
        offset += chunkSize;
        frameIndex += 1;

        if (!isLast) {
          setTimeout(sendNextFrame, FRAME_INTERVAL_MS);
        }
      }

      sendNextFrame();
    });

    ws.on("message", (data: Buffer | string) => {
      const text = typeof data === "string" ? data : data.toString("utf-8");

      let response: IflytekResponse;

      try {
        response = JSON.parse(text) as IflytekResponse;
      } catch {
        return;
      }

      if (response.code !== 0) {
        cleanup();
        ws.close();
        reject(
          new Error(
            `iFlytek ASR error ${response.code}: ${response.message}`,
          ),
        );
        return;
      }

      if (response.data?.result) {
        const result = response.data.result;
        const segmentText = extractResultText(result);

        // Handle progressive results (pgs = "rpl" replaces previous segments)
        if (result.pgs === "rpl" && result.rg) {
          const [start, end] = result.rg;

          for (let sn = start; sn <= end; sn++) {
            resultSegments.delete(sn);
          }
        }

        resultSegments.set(result.sn, segmentText);
      }

      // status === 2 means recognition complete
      if (response.data?.status === 2) {
        cleanup();
        ws.close();

        // Assemble final transcript from all segments in order
        const sortedKeys = [...resultSegments.keys()].sort((a, b) => a - b);
        const transcript = sortedKeys
          .map((key) => resultSegments.get(key) ?? "")
          .join("");

        resolve(transcript.trim());
      }
    });

    ws.on("close", () => {
      cleanup();
      // If we haven't resolved yet, resolve with whatever we have
      const sortedKeys = [...resultSegments.keys()].sort((a, b) => a - b);
      const transcript = sortedKeys
        .map((key) => resultSegments.get(key) ?? "")
        .join("");

      resolve(transcript.trim());
    });
  });
}
