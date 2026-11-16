import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const rate = 16000;
const seconds = 16;
const hop = 400;
const frequencies = [100, 600, 3000];
const bands = [[60, 250], [250, 2000], [2000, 7500]];
const samples = new Float64Array(rate * seconds);
for (let i = 0; i < samples.length; i++) {
  const t = i / rate;
  const pulse = Math.exp(-10 * (t % 0.5));
  samples[i] = frequencies.reduce((sum, hz, band) => sum + Math.sin(2 * Math.PI * hz * t) * (0.05 + pulse * 0.15) * (1 + Math.sin(t * (band + 1))) / 2, 0);
}
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) {
  const pcm = Math.round(samples[i] * 32767);
  wav.writeInt16LE(pcm, 44 + i * 2);
  samples[i] = pcm / 32768;
}
const frames = [];
for (let start = 0; start < samples.length; start += hop) {
  const window = samples.subarray(start, start + hop);
  const energy = bands.map(() => 0);
  for (let k = 1; k <= hop / 2; k++) {
    const hz = k * rate / hop;
    const band = bands.findIndex(([low, high]) => hz >= low && hz < high);
    if (band < 0) continue;
    let real = 0, imaginary = 0;
    for (let n = 0; n < window.length; n++) {
      real += window[n] * Math.cos(2 * Math.PI * k * n / hop);
      imaginary -= window[n] * Math.sin(2 * Math.PI * k * n / hop);
    }
    energy[band] += 2 * (real * real + imaginary * imaginary) / (hop * hop);
  }
  frames.push({ min: Math.min(...window), max: Math.max(...window), rms: Math.sqrt(window.reduce((sum, x) => sum + x * x, 0) / window.length), bands: energy });
}
const sha256 = createHash('sha256').update(wav).digest('hex');
const assetPath = `/experiments/${sha256}.wav`;
const analysis = {
  schema: 'fm.plyr.analysis.experimental.v1', content: { sha256, bytes: wav.length, path: assetPath },
  timebase: 'seconds', channels: 'mono', sampleRate: rate, windowSamples: hop, hopSamples: hop,
  normalization: 'none', bandsHz: bands, frames,
  onsets: Array.from({ length: seconds * 2 }, (_, i) => i * 0.5)
};
await writeFile(new URL('../static' + assetPath, import.meta.url), wav);
await writeFile(new URL('../static/experiments/embed-analysis.json', import.meta.url), JSON.stringify(analysis));
