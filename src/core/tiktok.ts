// Stage 6: a TikTok script from the published post, queued in tiktok-publisher.
//
// The Raspberry Pi (publish_daily.py, 9:15 with retries at 10:15 and 11:15) renders every
// guiones/AAAA-MM-DD*.json of the day with the Kokoro voice and the usual style, so this
// only has to leave guiones/AAAA-MM-DD-voz.json there. It never replaces the planned
// scripts (daily, book, promo): it is one extra video. One voice script per day; if that
// day is taken, it goes to the next free day (a queue).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ask, loadPrompt } from '../claude.ts';
import type { Config } from '../config.ts';
import { createRepoFile, getRepoFile } from './github.ts';
import { isoDate, stamp } from './ids.ts';
import { jobDir, saveJob, type Job, type TikTokInfo } from './job.ts';

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** What Claude writes; tag, brand and lang are added in code. */
export const TikTokDraft = z
	.object({
		topic: z.string().min(2).max(20),
		caption: z.string().min(10).max(150),
		hashtags: z.array(z.string().regex(/^#[^\s#]+$/)).min(3).max(5),
		slides: z
			.array(
				z.object({
					screen: z.string().min(1).refine((s) => words(s) <= 7, 'screen: máximo 7 palabras'),
					say: z.string().min(1).refine((s) => words(s) <= 25, 'say: máximo 25 palabras'),
					photo: z.string().min(2).max(40).optional()
				})
			)
			.min(4)
			.max(6)
	})
	.refine((d) => {
		const total = d.slides.reduce((n, s) => n + words(s.say), 0);
		return total >= 50 && total <= 120;
	}, 'texto hablado total fuera de 50-120 palabras')
	.refine((d) => /sígueme para más\.?$/i.test(d.slides[d.slides.length - 1].say.trim()), 'la última diapositiva debe terminar con "Sígueme para más."');
export type TikTokDraft = z.infer<typeof TikTokDraft>;

/** Same format as the scheduled tasks' scripts (guiones/AAAA-MM-DD.json). */
export type TikTokScript = {
	lang: 'es';
	tag: string;
	brand: string;
	caption: string;
	hashtags: string[];
	slides: { screen: string; say: string; photo?: string }[];
};

const DAYS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

export function weekdayEs(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function scriptPath(date: string): string {
	return `guiones/${date}-voz.json`;
}

/**
 * First day the Pi will still run: today before `cutoffHour` (local), otherwise tomorrow.
 * A script made in the afternoon goes out the next morning with the planned ones.
 */
export function firstQueueDate(now: Date, timeZone: string, cutoffHour: number): string {
	const today = isoDate(now, timeZone);
	const hour = Number(stamp(now, timeZone).slice(8, 10));
	return hour < cutoffHour ? today : addDays(today, 1);
}

export function buildScript(draft: TikTokDraft, date: string): TikTokScript {
	const hashtags = draft.hashtags.map((h) => h.toLowerCase());
	if (!hashtags.includes('#techtok')) {
		if (hashtags.length >= 5) hashtags.pop();
		hashtags.push('#techtok');
	}
	return {
		lang: 'es',
		tag: `${draft.topic.trim().toUpperCase()} · ${weekdayEs(date)}`,
		brand: 'geminislabs.com',
		caption: draft.caption.trim(),
		hashtags,
		slides: draft.slides.map((s) => ({
			screen: s.screen.trim(),
			say: s.say.trim(),
			...(s.photo?.trim() ? { photo: s.photo.trim() } : {})
		}))
	};
}

export function renderScript(script: TikTokScript): string {
	return JSON.stringify(script, null, 2) + '\n';
}

export async function generateTikTokDraft(config: Config, job: Job): Promise<TikTokDraft> {
	if (!job.draft) throw new Error('No draft found on job');
	const es = job.audio?.lang === 'en' ? job.draft.adapted : job.draft.original;
	// Images and links add nothing to a spoken script.
	const body = es.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
	const input = [
		'<post_es>',
		`Título: ${es.title}`,
		`Descripción: ${es.description}`,
		`Hashtags del post: ${es.hashtags.join(', ')}`,
		'',
		body.trim(),
		'</post_es>'
	].join('\n');
	const voice = await loadPrompt('voice');
	const system = (await loadPrompt('tiktok')).replace('{{voice}}', voice);
	return ask(config, { system, input, schema: TikTokDraft });
}

export type QueueResult = TikTokInfo & { script: TikTokScript; alreadyQueued: boolean };

/**
 * Writes the script for the first free day from `firstQueueDate`, verifies it by reading
 * it back and records it on the job. Idempotent: a job is queued only once.
 */
export async function queueTikTok(
	config: Config,
	job: Job,
	opts: { token: string; author: { name: string; email: string }; log?: (msg: string) => void; now?: Date }
): Promise<QueueResult> {
	const { repo, branch, cutoffHour } = config.tiktok;
	if (job.tiktok) {
		const existing = await getRepoFile(opts.token, repo, job.tiktok.path, branch);
		if (existing) return { ...job.tiktok, script: JSON.parse(existing.content), alreadyQueued: true };
	}

	opts.log?.('escribiendo guion de TikTok (voz Kokoro, español)…');
	const draft = await generateTikTokDraft(config, job);

	let date = firstQueueDate(opts.now ?? new Date(), config.timezone, cutoffHour);
	for (let i = 0; i < 60; i++, date = addDays(date, 1)) {
		const path = scriptPath(date);
		if (await getRepoFile(opts.token, repo, path, branch)) continue; // day taken: next one
		const script = buildScript(draft, date);
		const content = renderScript(script);
		let commitSha: string;
		try {
			commitSha = await createRepoFile(opts.token, repo, {
				path,
				branch,
				content,
				message: `Guion voz ${date}: ${job.postId}\n\nCo-Authored-By: ${config.git.coAuthor}`,
				author: opts.author
			});
		} catch (e) {
			if (/\(422\)/.test((e as Error).message)) continue; // created meanwhile: next day
			throw e;
		}
		// Only a file read back counts as saved.
		const back = await getRepoFile(opts.token, repo, path, branch);
		if (!back || back.content !== content) throw new Error(`no se pudo verificar ${path} en ${repo}`);

		const info: TikTokInfo = { path, date, commitSha, queuedAt: new Date().toISOString() };
		job.tiktok = info;
		await saveJob(config, job);
		if (job.postId) {
			const shareDir = join(jobDir(config, job.key), 'post', job.postId, 'share');
			await mkdir(shareDir, { recursive: true });
			await writeFile(join(shareDir, 'tiktok.json'), content).catch(() => {});
		}
		opts.log?.(`guion de TikTok encolado: ${path} (sale el ${weekdayEs(date).toLowerCase()} ${date})`);
		return { ...info, script, alreadyQueued: false };
	}
	throw new Error('no hay día libre para el guion de TikTok en los próximos 60 días');
}
