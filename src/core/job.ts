// Per-post state in data/<job>/job.json, so a job can resume after a crash or a pause.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
