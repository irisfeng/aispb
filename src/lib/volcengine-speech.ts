import { Service } from "@volcengine/openapi";

const VOLC_SERVICE_NAME = "sami";
const VOLC_SERVICE_REGION = "cn-north-1";
const VOLC_SERVICE_VERSION = "2021-07-27";
const VOLC_TOKEN_VERSION = "volc-auth-v1";
const VOLC_TTS_INVOKE_URL = "https://sami.bytedance.com/api/v1/invoke";
const VOLC_SUCCESS_STATUS_CODE = 20_000_000;
const DEFAULT_SPEAKER = "en_female_samc";
const DEFAULT_AUDIO_FORMAT = "mp3";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3_600;
const TOKEN_REFRESH_BUFFER_SECONDS = 90;

interface VolcTokenResponse {
  token?: string;
  expires_at?: number;
  status_code: number;
  status_text: string;
  task_id?: string;
}

interface VolcInvokeResponse {
  data?: string;
  payload?: string;
  status_code: number;
  status_text: string;
  task_id?: string;
}

interface VolcInvokePayload {
  duration?: number;
}

interface CachedVolcToken {
  token: string;
  expiresAt: number;
}

interface VolcSpeechConfig {
  accessKeyId: string;
  secretKey: string;
  appKey: string;
  speaker: string;
  format: string;
  sampleRate: number;
  tokenTtlSeconds: number;
}

export interface PronouncerProviderStatus {
  configured: boolean;
  provider: string;
  speaker: string | null;
  format: string | null;
}

export interface VolcSpeechSynthesisResult {
  audioBuffer: Buffer;
  contentType: string;
  durationSeconds: number | null;
  provider: string;
  speaker: string;
}

declare global {
  var __aispbVolcSpeechTokenCache: CachedVolcToken | undefined;
}

function getEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function getNumberEnvValue(key: string, fallback: number) {
  const rawValue = process.env[key]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function getVolcSpeechConfig(): VolcSpeechConfig {
  const accessKeyId = getEnvValue("VOLC_ACCESSKEY", "VOLCENGINE_ACCESS_KEY_ID");
  const secretKey = getEnvValue(
    "VOLC_SECRETKEY",
    "VOLCENGINE_SECRET_ACCESS_KEY",
  );
  const appKey = getEnvValue("VOLC_SPEECH_APP_KEY");

  return {
    accessKeyId,
    secretKey,
    appKey,
    speaker: getEnvValue("VOLC_SPEECH_SPEAKER") || DEFAULT_SPEAKER,
    format: getEnvValue("VOLC_SPEECH_AUDIO_FORMAT") || DEFAULT_AUDIO_FORMAT,
    sampleRate: getNumberEnvValue(
      "VOLC_SPEECH_SAMPLE_RATE",
      DEFAULT_SAMPLE_RATE,
    ),
    tokenTtlSeconds: Math.min(
      getNumberEnvValue(
        "VOLC_SPEECH_TOKEN_TTL_SECONDS",
        DEFAULT_TOKEN_TTL_SECONDS,
      ),
      86_400,
    ),
  };
}

export function hasVolcengineSpeechConfig() {
  const config = getVolcSpeechConfig();

  return Boolean(config.accessKeyId && config.secretKey && config.appKey);
}

export function getPronouncerProviderStatus(): PronouncerProviderStatus {
  const config = getVolcSpeechConfig();

  return {
    configured: hasVolcengineSpeechConfig(),
    provider: "Volcengine short-text TTS",
    speaker: hasVolcengineSpeechConfig() ? config.speaker : null,
    format: hasVolcengineSpeechConfig() ? config.format : null,
  };
}

function getContentType(format: string) {
  if (format === "wav") {
    return "audio/wav";
  }

  if (format === "aac") {
    return "audio/aac";
  }

  return "audio/mpeg";
}

async function getVolcSpeechToken(config: VolcSpeechConfig) {
  const currentTimeSeconds = Math.floor(Date.now() / 1000);
  const cachedToken = globalThis.__aispbVolcSpeechTokenCache;

  if (
    cachedToken &&
    cachedToken.expiresAt - currentTimeSeconds > TOKEN_REFRESH_BUFFER_SECONDS
  ) {
    return cachedToken.token;
  }

  const service = new Service({
    serviceName: VOLC_SERVICE_NAME,
    region: VOLC_SERVICE_REGION,
    host: "open.volcengineapi.com",
    protocol: "https",
    defaultVersion: VOLC_SERVICE_VERSION,
  });

  service.setAccessKeyId(config.accessKeyId);
  service.setSecretKey(config.secretKey);

  const getToken = service.createJSONAPI("GetToken");
  const response = (await getToken({
    appkey: config.appKey,
    token_version: VOLC_TOKEN_VERSION,
    expiration: config.tokenTtlSeconds,
  })) as unknown as VolcTokenResponse;

  if (
    response.status_code !== VOLC_SUCCESS_STATUS_CODE ||
    !response.token ||
    !response.expires_at
  ) {
    throw new Error(
      `Volc token request failed: ${response.status_text || "unknown error"}`,
    );
  }

  globalThis.__aispbVolcSpeechTokenCache = {
    token: response.token,
    expiresAt: response.expires_at,
  };

  return response.token;
}

export async function synthesizeWithVolcengineSpeech(
  text: string,
): Promise<VolcSpeechSynthesisResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("Pronouncer request is missing text.");
  }

  const config = getVolcSpeechConfig();

  if (!hasVolcengineSpeechConfig()) {
    throw new Error("Volcengine speech configuration is incomplete.");
  }

  const token = await getVolcSpeechToken(config);
  const invokeResponse = await fetch(VOLC_TTS_INVOKE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      appkey: config.appKey,
      namespace: "TTS",
      payload: JSON.stringify({
        text: normalizedText,
        speaker: config.speaker,
        audio_config: {
          format: config.format,
          sample_rate: config.sampleRate,
          speech_rate: 0,
          pitch_rate: 0,
        },
      }),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!invokeResponse.ok) {
    throw new Error(
      `Volc TTS HTTP request failed with ${invokeResponse.status}`,
    );
  }

  const payload = (await invokeResponse.json()) as VolcInvokeResponse;

  if (payload.status_code !== VOLC_SUCCESS_STATUS_CODE || !payload.data) {
    throw new Error(
      `Volc TTS synthesis failed: ${payload.status_text || "unknown error"}`,
    );
  }

  let invokePayload: VolcInvokePayload | null = null;

  if (payload.payload) {
    try {
      invokePayload = JSON.parse(payload.payload) as VolcInvokePayload;
    } catch (error) {
      console.error("volc speech payload parse fallback", error);
    }
  }

  return {
    audioBuffer: Buffer.from(payload.data, "base64"),
    contentType: getContentType(config.format),
    durationSeconds: invokePayload?.duration ?? null,
    provider: "Volcengine short-text TTS",
    speaker: config.speaker,
  };
}
