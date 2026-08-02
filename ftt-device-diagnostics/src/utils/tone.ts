import * as FileSystem from 'expo-file-system';

/**
 * Generates a mono 16-bit PCM WAV of a sine tone and writes it to the cache,
 * returning a file:// URI that expo-av can play. Doing this at runtime means
 * we ship no binary audio assets — handy for a diagnostics tool.
 */
export async function writeToneFile(
  freq = 1000,
  seconds = 2,
  sampleRate = 44100,
): Promise<string> {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF / WAVE header
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Samples with a short fade in/out to avoid clicks.
  const fade = Math.min(sampleRate * 0.02, numSamples / 2);
  for (let i = 0; i < numSamples; i += 1) {
    let amp = 0.6;
    if (i < fade) amp *= i / fade;
    else if (i > numSamples - fade) amp *= (numSamples - i) / fade;
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }

  // Base64-encode the buffer.
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = globalThis.btoa ? globalThis.btoa(binary) : Buffer.from(binary, 'binary').toString('base64');

  const uri = `${FileSystem.cacheDirectory}tone_${freq}.wav`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}
