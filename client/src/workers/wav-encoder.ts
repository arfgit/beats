/**
 * WAV encoder Web Worker.
 *
 * Input: { blob: Blob, mimeType: string }
 * Output: { wav: Blob } | { error: string }
 *
 * Uses OfflineAudioContext to decode the recorded container (webm/mp4),
 * then hands the AudioBuffer to the pure `encodeWav` helper. Keeping the
 * encoder pure + importable lets unit tests exercise it directly.
 */
import { encodeWav } from "../lib/wav";

type InputMessage = { blob: Blob; mimeType: string };
type OutputMessage = { wav: Blob } | { error: string };

self.onmessage = async (evt: MessageEvent<InputMessage>) => {
  try {
    const { blob } = evt.data;
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await decode(arrayBuffer);
    const wav = encodeWav(audioBuffer);
    const out: OutputMessage = { wav: new Blob([wav], { type: "audio/wav" }) };
    self.postMessage(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const out: OutputMessage = { error: message };
    self.postMessage(out);
  }
};

async function decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 48000);
  return ctx.decodeAudioData(arrayBuffer);
}

export {};
