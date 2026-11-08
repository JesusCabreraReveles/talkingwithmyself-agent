// Per-post state in data/<job>/job.json, so a job can resume after a crash or a pause.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import type { Localized, Original } from './draft.ts';
import type { Lang } from './schema/post.ts';

export type Status =
	| 'collecting'
	| 'transcribed'
	| 'questions_pending'
	| 'drafted'
	| 'reviewed'
	| 'ready'
	| 'previewed'
	| 'published'
	| 'paused'
	| 'failed';

export type UncertainTerm = { heard: string; guess: string; why: string; confirmed?: string };

/**
 * A passage the cleanup marked `[?]`. Jesus says what he meant; '' keeps it doubtful
 * (never a firm claim), OMIT drops it.
 */
export type UnclearPassage = { passage: string; question: string; answer?: string };
export const OMIT = 'omitir';

export type InputImage = {
	file: string;
	/** "cover", a body position (1, 2…), or null when Claude places it. */
	role: 'cover' | number | null;
	caption: string;
	/** Converted copy under images/ (cover 1200×630, body ≤ maxWidth), once processed. */
	webp?: string;
	/** Described by Claude from the image + caption, in the note's language. */
	alt?: string;
};

export type PublishInfo = {
	branch: string;
	prNumber?: number;
	prUrl?: string;
	commitSha?: string;
	previewUrl?: string;
	publishedAt?: string;
	publishedDate?: string;
};

export type Job = {
	/** Folder name under data/: the AAAAMMDDHHmm stamp until the slug is known. */
	key: string;
	stamp: string;
	createdAt: string;
	status: Status;
	error?: string;
	input: { audio?: string; images: InputImage[]; urls: string[]; notes: string };
	/** Publish audio.mp3 + transcript.md with the post. Opt-in, off by default. */
	publishAudio: boolean;
	audio?: { lang: Lang; duration: number };
	transcript?: { raw: string; clean: string };
	terms?: UncertainTerm[];
	unclear?: UnclearPassage[];
	sources?: { url: string; title: string; text: string; error?: string }[];
	postId?: string;
	draft?: { original: Original; adapted: Localized };
	review?: { removed: string[] };
	publish?: PublishInfo;
	/** TikTok script queued in tiktok-publisher (guiones/AAAA-MM-DD-voz.json), once. */
	tiktok?: TikTokInfo;
};

export type TikTokInfo = {
	/** Path in the tiktok-publisher repo, e.g. guiones/2026-11-08-voz.json. */
	path: string;
	/** Day the Raspberry Pi turns it into a video (AAAA-MM-DD). */
	date: string;
	commitSha: string;
	queuedAt: string;
};

export function jobDir(config: Config, key: string): string {
	return join(config.paths.data, key);
}

export async function saveJob(config: Config, job: Job): Promise<void> {
	const dir = jobDir(config, job.key);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, '\t') + '\n');
}

export async function loadJob(config: Config, key: string): Promise<Job> {
	return JSON.parse(await readFile(join(jobDir(config, key), 'job.json'), 'utf8'));
}

/**
 * Loads a job by key (e.g. 202611010153) or searches by postId (e.g. 202611010153-slug).
 */
export async function findJob(config: Config, identifier: string): Promise<Job> {
	try {
		return await loadJob(config, identifier);
	} catch {}

	try {
		const entries = await readdir(config.paths.data, { withFileTypes: true });
		for (const e of entries) {
			if (!e.isDirectory() || e.name === 'covers') continue;
			try {
				const job = await loadJob(config, e.name);
				if (job.postId === identifier || job.stamp === identifier || job.key === identifier) {
					return job;
				}
			} catch {}
		}
	} catch {}

	throw new Error(`job no encontrado: "${identifier}"`);
}

/**
 * Lists all jobs found in data/ ordered chronologically by key.
 */
export async function listJobs(config: Config): Promise<Job[]> {
	try {
		const entries = await readdir(config.paths.data, { withFileTypes: true });
		const jobs: Job[] = [];
		for (const e of entries) {
			if (!e.isDirectory() || e.name === 'covers') continue;
			try {
				const j = await loadJob(config, e.name);
				jobs.push(j);
			} catch {}
		}
		return jobs.sort((a, b) => a.key.localeCompare(b.key));
	} catch {
		return [];
	}
}
