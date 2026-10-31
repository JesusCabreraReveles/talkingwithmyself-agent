// Voice note → audio.mp3 (mono, loudness-normalized, silence trimmed) + 16 kHz WAV for Whisper.
import { exec } from './exec.ts';

const TRIM =
	'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,' +
	'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,areverse';

export async function toMp3(input: string, output: string, bitrate: string): Promise<void> {
	await exec('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', `${TRIM},loudnorm`, '-ac', '1', '-b:a', bitrate, output]);
}

export async function toWav(input: string, output: string): Promise<void> {
	await exec('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
}

export async function durationSeconds(file: string): Promise<number> {
	const out = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
	return Math.round(Number(out.trim()));
}
