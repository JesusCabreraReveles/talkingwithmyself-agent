// Voice note → audio.mp3 (mono, loudness-normalized, silence trimmed) + 16 kHz WAV for Whisper.
import { rm } from 'node:fs/promises';
import { exec } from './exec.ts';

const TRIM =
	'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,' +
	'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.3,areverse';

// Two passes on purpose: ffmpeg 7.1 (Debian/Raspberry Pi OS) aborts with
// "Assertion best_input >= 0 failed at ffmpeg_filter.c" when silenceremove+areverse
// and loudnorm share one filter graph.
export async function toMp3(input: string, output: string, bitrate: string): Promise<void> {
	const trimmed = output.replace(/\.mp3$/, '') + '.trimmed.wav';
	try {
		await exec('ffmpeg', ['-v', 'error', '-y', '-i', input, '-af', TRIM, '-ac', '1', '-c:a', 'pcm_s16le', trimmed]);
		if (!((await rawDuration(trimmed).catch(() => 0)) > 0)) {
			throw new Error('la nota de voz está vacía o es solo silencio');
		}
		await exec('ffmpeg', ['-v', 'error', '-y', '-i', trimmed, '-af', 'loudnorm', '-ac', '1', '-b:a', bitrate, output]);
	} finally {
		await rm(trimmed, { force: true });
	}
}

export async function toWav(input: string, output: string): Promise<void> {
	await exec('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
}

async function rawDuration(file: string): Promise<number> {
	const out = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
	return Number(out.trim());
}

export async function durationSeconds(file: string): Promise<number> {
	return Math.round(await rawDuration(file));
}
