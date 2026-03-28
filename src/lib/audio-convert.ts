/**
 * Audio format conversion utilities.
 *
 * Uses ffmpeg (available on Vercel serverless functions via the system layer)
 * to convert browser-recorded audio (WebM/Opus) to PCM 16kHz mono — the
 * format required by iFlytek streaming ASR.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Convert an audio buffer (typically WebM/Opus from MediaRecorder) to
 * raw PCM 16-bit signed little-endian, 16 kHz, mono.
 *
 * Returns a Node.js Buffer of PCM samples.
 */
export async function convertToPcm16kMono(
  audioBuffer: ArrayBuffer,
): Promise<Buffer> {
  const id = randomUUID().slice(0, 8);
  const inputPath = join(tmpdir(), `aispb-in-${id}.webm`);
  const outputPath = join(tmpdir(), `aispb-out-${id}.pcm`);

  try {
    // Write input to temp file
    await writeFile(inputPath, Buffer.from(audioBuffer));

    // Convert with ffmpeg: → PCM s16le, 16 kHz, mono
    await new Promise<void>((resolve, reject) => {
      execFile(
        "ffmpeg",
        [
          "-y",
          "-i", inputPath,
          "-f", "s16le",
          "-acodec", "pcm_s16le",
          "-ar", "16000",
          "-ac", "1",
          outputPath,
        ],
        { timeout: 10_000 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `ffmpeg conversion failed: ${error.message}\n${stderr}`,
              ),
            );
          } else {
            resolve();
          }
        },
      );
    });

    return await readFile(outputPath);
  } finally {
    // Best-effort cleanup
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}
