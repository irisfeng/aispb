import crypto from "node:crypto";

import { Service } from "@volcengine/openapi";

const LEGACY_SERVICE_NAME = "sami";
const LEGACY_SERVICE_REGION = "cn-north-1";
const LEGACY_SERVICE_VERSION = "2021-07-27";
const LEGACY_TOKEN_VERSION = "volc-auth-v1";
const LEGACY_TTS_INVOKE_URL = "https://sami.bytedance.com/api/v1/invoke";
const V3_TTS_SSE_URL =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse";
const VOLC_SUCCESS_STATUS_CODE = 20_000_000;
const LEGACY_PROVIDER_LABEL = "Volcengine SAMI short-text TTS";
const V3_PROVIDER_LABEL = "Volcengine Doubao Speech TTS V3";
const DEFAULT_LEGACY_SPEAKER = "en_female_samc";
const DEFAULT_V3_SPEAKER = "en_female_dacey_uranus_bigtts";
const DEFAULT_AUDIO_FORMAT = "mp3";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3_600;
const DEFAULT_V3_RESOURCE_ID = "seed-tts-2.0";
const TOKEN_REFRESH_BUFFER_SECONDS = 90;

type PronouncerProviderMode = "v3" | "legacy" | "unconfigured";

interface VolcTokenResponse {
  token?: string;
  expires_at?: number;
  status_code: number;
  status_text: string;
}

interface VolcInvokeResponse {
  data?: string;
  payload?: string;
  status_code: number;
  status_text: string;
}

interface VolcInvokePayload {
  duration?: number;
}

interface CachedVolcToken {
  token: string;
  expiresAt: number;
}

interface VolcSseEventPayload {
  code?: number;
  message?: string;
  data?: string | null;
}

interface VolcSpeechConfig {
  accessKeyId: string;
  accessToken: string;
  appKey: string;
  audioFormat: string;
  requestedSpeaker: string;
  resourceId: string;
  sampleRate: number;
  secretKey: string;
  tokenTtlSeconds: number;
  useLegacy: boolean;
}

export interface PronouncerProviderStatus {
  configured: boolean;
  detail: string;
  format: string | null;
  mode: PronouncerProviderMode;
  provider: string;
  speaker: string | null;
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

class PronouncerProviderError extends Error {
  detail: string | null;
  statusCode: number;

  constructor(
    message: string,
    options?: {
      detail?: string | null;
      statusCode?: number;
    },
  ) {
    super(message);
    this.name = "PronouncerProviderError";
    this.detail = options?.detail ?? null;
    this.statusCode = options?.statusCode ?? 502;
  }
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

function getBooleanEnvValue(key: string) {
  const rawValue = process.env[key]?.trim().toLowerCase();

  return rawValue === "1" || rawValue === "true" || rawValue === "yes";
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
  return {
    accessKeyId: getEnvValue("VOLC_ACCESSKEY", "VOLCENGINE_ACCESS_KEY_ID"),
    accessToken: getEnvValue(
      "VOLC_SPEECH_ACCESS_TOKEN",
      "VOLC_SPEECH_TOKEN",
      "VOLC_SPEECH_ACCESS_KEY",
    ),
    appKey: getEnvValue("VOLC_SPEECH_APP_ID", "VOLC_SPEECH_APP_KEY"),
    audioFormat:
      getEnvValue("VOLC_SPEECH_AUDIO_FORMAT") || DEFAULT_AUDIO_FORMAT,
    requestedSpeaker: getEnvValue("VOLC_SPEECH_SPEAKER"),
    resourceId:
      getEnvValue("VOLC_SPEECH_RESOURCE_ID") || DEFAULT_V3_RESOURCE_ID,
    sampleRate: getNumberEnvValue(
      "VOLC_SPEECH_SAMPLE_RATE",
      DEFAULT_SAMPLE_RATE,
    ),
    secretKey: getEnvValue("VOLC_SECRETKEY", "VOLCENGINE_SECRET_ACCESS_KEY"),
    tokenTtlSeconds: Math.min(
      getNumberEnvValue(
        "VOLC_SPEECH_TOKEN_TTL_SECONDS",
        DEFAULT_TOKEN_TTL_SECONDS,
      ),
      86_400,
    ),
    useLegacy: getBooleanEnvValue("VOLC_SPEECH_USE_LEGACY"),
  };
}

function getPronouncerMode(config: VolcSpeechConfig): PronouncerProviderMode {
  if (config.appKey && config.accessToken) {
    return "v3";
  }

  if (
    config.useLegacy &&
    config.accessKeyId &&
    config.secretKey &&
    config.appKey
  ) {
    return "legacy";
  }

  return "unconfigured";
}

function normalizeSpeaker(
  requestedSpeaker: string,
  mode: Exclude<PronouncerProviderMode, "unconfigured">,
) {
  if (!requestedSpeaker) {
    return mode === "v3" ? DEFAULT_V3_SPEAKER : DEFAULT_LEGACY_SPEAKER;
  }

  if (mode === "v3" && requestedSpeaker === DEFAULT_LEGACY_SPEAKER) {
    return DEFAULT_V3_SPEAKER;
  }

  if (mode === "legacy" && requestedSpeaker === DEFAULT_V3_SPEAKER) {
    return DEFAULT_LEGACY_SPEAKER;
  }

  return requestedSpeaker;
}

function getStatusProviderLabel(config: VolcSpeechConfig) {
  if (getPronouncerMode(config) === "legacy" || config.useLegacy) {
    return LEGACY_PROVIDER_LABEL;
  }

  return V3_PROVIDER_LABEL;
}

function getStatusDetail(config: VolcSpeechConfig) {
  const mode = getPronouncerMode(config);

  if (mode === "v3") {
    return `Doubao Speech V3 is active with APP ID credentials and speaker ${normalizeSpeaker(config.requestedSpeaker, "v3")}.`;
  }

  if (mode === "legacy") {
    return `Legacy SAMI short-text TTS is active with speaker ${normalizeSpeaker(config.requestedSpeaker, "legacy")}.`;
  }

  if (!config.appKey) {
    return "Missing VOLC_SPEECH_APP_ID. Add the Speech console APP ID before enabling cloud pronouncer playback.";
  }

  if (!config.accessToken) {
    return "Doubao Speech V3 needs VOLC_SPEECH_ACCESS_TOKEN from the Speech console. AK/SK alone only work with the legacy SAMI path, which must be opted into with VOLC_SPEECH_USE_LEGACY=true.";
  }

  return "Volcengine pronouncer is not fully configured yet.";
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

function buildProviderStatus(
  config: VolcSpeechConfig,
  mode: PronouncerProviderMode,
): PronouncerProviderStatus {
  const provider = getStatusProviderLabel(config);
  const speaker =
    mode === "legacy"
      ? normalizeSpeaker(config.requestedSpeaker, "legacy")
      : normalizeSpeaker(config.requestedSpeaker, "v3");

  return {
    configured: mode !== "unconfigured",
    detail: getStatusDetail(config),
    format: mode === "unconfigured" ? null : config.audioFormat,
    mode,
    provider,
    speaker,
  };
}

export function hasVolcengineSpeechConfig() {
  return getPronouncerMode(getVolcSpeechConfig()) !== "unconfigured";
}

export function getPronouncerProviderStatus(): PronouncerProviderStatus {
  const config = getVolcSpeechConfig();

  return buildProviderStatus(config, getPronouncerMode(config));
}

function ensureConfiguredMode(config: VolcSpeechConfig) {
  const mode = getPronouncerMode(config);

  if (mode === "unconfigured") {
    throw new PronouncerProviderError(
      "Pronouncer provider is not configured.",
      {
        detail: getStatusDetail(config),
        statusCode: 503,
      },
    );
  }

  return mode;
}

async function getLegacyVolcSpeechToken(config: VolcSpeechConfig) {
  const currentTimeSeconds = Math.floor(Date.now() / 1000);
  const cachedToken = globalThis.__aispbVolcSpeechTokenCache;

  if (
    cachedToken &&
    cachedToken.expiresAt - currentTimeSeconds > TOKEN_REFRESH_BUFFER_SECONDS
  ) {
    return cachedToken.token;
  }

  const service = new Service({
    serviceName: LEGACY_SERVICE_NAME,
    region: LEGACY_SERVICE_REGION,
    host: "open.volcengineapi.com",
    protocol: "https:",
    defaultVersion: LEGACY_SERVICE_VERSION,
  });

  service.setAccessKeyId(config.accessKeyId);
  service.setSecretKey(config.secretKey);

  const getToken = service.createJSONAPI("GetToken");
  const response = (await getToken({
    appkey: config.appKey,
    expiration: config.tokenTtlSeconds,
    token_version: LEGACY_TOKEN_VERSION,
  })) as unknown as VolcTokenResponse;

  if (
    response.status_code !== VOLC_SUCCESS_STATUS_CODE ||
    !response.token ||
    !response.expires_at
  ) {
    throw new PronouncerProviderError(
      "Volcengine legacy token request failed.",
      {
        detail: response.status_text || "unknown error",
      },
    );
  }

  globalThis.__aispbVolcSpeechTokenCache = {
    token: response.token,
    expiresAt: response.expires_at,
  };

  return response.token;
}

async function synthesizeWithLegacyVolcengineSpeech(
  text: string,
  config: VolcSpeechConfig,
): Promise<VolcSpeechSynthesisResult> {
  const token = await getLegacyVolcSpeechToken(config);
  const speaker = normalizeSpeaker(config.requestedSpeaker, "legacy");
  const invokeResponse = await fetch(LEGACY_TTS_INVOKE_URL, {
    body: JSON.stringify({
      appkey: config.appKey,
      namespace: "TTS",
      payload: JSON.stringify({
        audio_config: {
          format: config.audioFormat,
          pitch_rate: 0,
          sample_rate: config.sampleRate,
          speech_rate: 0,
        },
        speaker,
        text,
      }),
      token,
    }),
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });

  if (!invokeResponse.ok) {
    throw new PronouncerProviderError(
      `Volcengine legacy TTS HTTP request failed with ${invokeResponse.status}.`,
    );
  }

  const payload = (await invokeResponse.json()) as VolcInvokeResponse;

  if (payload.status_code !== VOLC_SUCCESS_STATUS_CODE || !payload.data) {
    throw new PronouncerProviderError("Volcengine legacy synthesis failed.", {
      detail: payload.status_text || "unknown error",
    });
  }

  let invokePayload: VolcInvokePayload | null = null;

  if (payload.payload) {
    try {
      invokePayload = JSON.parse(payload.payload) as VolcInvokePayload;
    } catch (error) {
      console.error("volc legacy payload parse fallback", error);
    }
  }

  return {
    audioBuffer: Buffer.from(payload.data, "base64"),
    contentType: getContentType(config.audioFormat),
    durationSeconds: invokePayload?.duration ?? null,
    provider: LEGACY_PROVIDER_LABEL,
    speaker,
  };
}

async function parseErrorResponse(response: Response) {
  const errorBody = await response.text();

  if (!errorBody) {
    return `HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(errorBody) as {
      error?: {
        message?: string;
      };
      header?: {
        message?: string;
      };
      message?: string;
    };

    return (
      parsed.header?.message ||
      parsed.error?.message ||
      parsed.message ||
      errorBody
    );
  } catch {
    return errorBody;
  }
}

function processSseEventBlock(
  block: string,
  audioChunks: Buffer[],
): PronouncerProviderError | null {
  if (!block.trim()) {
    return null;
  }

  let eventId = "";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      eventId = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  let payload: VolcSseEventPayload;

  try {
    payload = JSON.parse(dataLines.join("\n")) as VolcSseEventPayload;
  } catch {
    return new PronouncerProviderError(
      "Volcengine V3 returned an unreadable SSE payload.",
    );
  }

  if (typeof payload.data === "string" && payload.data) {
    audioChunks.push(Buffer.from(payload.data, "base64"));
  }

  if (
    typeof payload.code === "number" &&
    payload.code !== 0 &&
    payload.code !== VOLC_SUCCESS_STATUS_CODE
  ) {
    return new PronouncerProviderError("Volcengine V3 synthesis failed.", {
      detail: payload.message || `event ${eventId || "unknown"}`,
    });
  }

  return null;
}

async function synthesizeWithVolcengineV3(
  text: string,
  config: VolcSpeechConfig,
): Promise<VolcSpeechSynthesisResult> {
  const speaker = normalizeSpeaker(config.requestedSpeaker, "v3");
  const response = await fetch(V3_TTS_SSE_URL, {
    body: JSON.stringify({
      namespace: "BidirectionalTTS",
      req_params: {
        audio_params: {
          format: config.audioFormat,
          sample_rate: config.sampleRate,
        },
        speaker,
        text,
      },
      user: {
        uid: "aispb-pronouncer",
      },
    }),
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "X-Api-Access-Key": config.accessToken,
      "X-Api-App-Id": config.appKey,
      "X-Api-Request-Id": crypto.randomUUID(),
      "X-Api-Resource-Id": config.resourceId,
    },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new PronouncerProviderError(
      `Volcengine V3 HTTP request failed with ${response.status}.`,
      {
        detail: await parseErrorResponse(response),
      },
    );
  }

  if (!response.body) {
    throw new PronouncerProviderError(
      "Volcengine V3 returned an empty response body.",
    );
  }

  const audioChunks: Buffer[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      bufferedText += decoder.decode();
      break;
    }

    bufferedText += decoder
      .decode(value, { stream: true })
      .replaceAll("\r\n", "\n");

    let separatorIndex = bufferedText.indexOf("\n\n");

    while (separatorIndex !== -1) {
      const block = bufferedText.slice(0, separatorIndex);
      bufferedText = bufferedText.slice(separatorIndex + 2);

      const processingError = processSseEventBlock(block, audioChunks);

      if (processingError) {
        throw processingError;
      }

      separatorIndex = bufferedText.indexOf("\n\n");
    }
  }

  if (bufferedText.trim()) {
    const processingError = processSseEventBlock(bufferedText, audioChunks);

    if (processingError) {
      throw processingError;
    }
  }

  if (!audioChunks.length) {
    throw new PronouncerProviderError(
      "Volcengine V3 completed without audio frames.",
    );
  }

  return {
    audioBuffer: Buffer.concat(audioChunks),
    contentType: getContentType(config.audioFormat),
    durationSeconds: null,
    provider: V3_PROVIDER_LABEL,
    speaker,
  };
}

export function getPronouncerErrorPayload(error: unknown) {
  if (error instanceof PronouncerProviderError) {
    return {
      detail: error.detail,
      error: error.message,
      statusCode: error.statusCode,
    };
  }

  return {
    detail: null,
    error: "Pronouncer synthesis failed.",
    statusCode: 502,
  };
}

export async function synthesizeWithVolcengineSpeech(
  text: string,
): Promise<VolcSpeechSynthesisResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new PronouncerProviderError("Pronouncer request is missing text.", {
      statusCode: 400,
    });
  }

  const config = getVolcSpeechConfig();
  const mode = ensureConfiguredMode(config);

  if (mode === "legacy") {
    return synthesizeWithLegacyVolcengineSpeech(normalizedText, config);
  }

  return synthesizeWithVolcengineV3(normalizedText, config);
}
