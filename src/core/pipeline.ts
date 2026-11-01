// One post from an input folder to a validated blog post folder. Every step saves the
// job, so `resume` continues where it stopped (Claude paused, terms pending, crash).
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parse } from 'yaml';
import { ClaudeUnavailable } from '../claude.ts';
import { addToGlossary, type Config } from '../config.ts';
import { durationSeconds, toMp3, toWav } from './audio.ts';
import { adapt, cleanTranscript, describeImage, draftOriginal, review } from './draft.ts';
import { isoDate, postId, stamp } from './ids.ts';
import { generateCover, toBodyImage, toCover } from './images.ts';
import {
	jobDir,
	OMIT,
	saveJob,
	type InputImage,
	type Job,
	type UncertainTerm,
	type UnclearPassage
} from './job.ts';
import { imageErrors, writePost } from './render.ts';
import { SiteConfig } from './schema/site.ts';
import { validatePostFolder } from './schema/validate.ts';
import { readSource } from './sources.ts';
import { transcribe } from './transcribe.ts';

const AUDIO = new Set(['.ogg', '.oga', '.opus', '.mp3', '.m4a', '.mpeg', '.wav', '.aac']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif']);

export type Hooks = {
	log: (msg: string) => void;
	/**
	 * Returns the spelling per term, or null when nobody can answer now. `fromJesus`
	 * is false when guesses were accepted blindly (--yes): those never reach the glossary.
	 */
	confirmTerms: (terms: UncertainTerm[]) => Promise<{ answers: string[]; fromJesus: boolean } | null>;
	/** What Jesus meant per `[?]` passage ('' = leave it doubtful, OMIT = drop it), or null. */
	clarify: (passages: UnclearPassage[]) => Promise<string[] | null>;
};

/**
 * Image role from its caption (Telegram) or file name (CLI):
 * "#portada …" / "#cover …" → cover, "#2 …" → body position 2, anything else → free.
 */
export function imageRole(caption: string): { role: InputImage['role']; caption: string } {
	const text = caption.trim();
	const cover = /^#?(portada|cover)\b[\s_-]*/i.exec(text);
	if (cover) return { role: 'cover', caption: text.slice(cover[0].length) };
	const pos = /^#?(\d+)\b[\s_-]*/.exec(text);
	if (pos) return { role: Number(pos[1]), caption: text.slice(pos[0].length) };
	return { role: null, caption: text };
}

/** CLI input folder: exactly one audio file, images, optional urls.txt and notas.txt / notes.txt. */
export async function createJob(
	config: Config,
	inputDir: string,
	opts: { publishAudio?: boolean; now?: Date } = {}
): Promise<Job> {
	const now = opts.now ?? new Date();
	const s = stamp(now, config.timezone);
	const job: Job = {
		key: s,
		stamp: s,
		createdAt: now.toISOString(),
		status: 'collecting',
		publishAudio: opts.publishAudio ?? false,
		input: { images: [], urls: [], notes: '' }
	};
	const inDir = join(jobDir(config, job.key), 'input');
	await mkdir(inDir, { recursive: true });

	for (const name of (await readdir(inputDir)).sort()) {
		const ext = extname(name).toLowerCase();
		const src = join(inputDir, name);
		if (AUDIO.has(ext)) {
			if (job.input.audio) throw new Error(`more than one audio file in ${inputDir}`);
			job.input.audio = `input/audio${ext}`;
			await copyFile(src, join(inDir, `audio${ext}`));
		} else if (IMAGE.has(ext)) {
			const caption = basename(name, extname(name)).replace(/[_-]+/g, ' ');
			const file = `input/image-${job.input.images.length + 1}${ext}`;
			await copyFile(src, join(jobDir(config, job.key), file));
			job.input.images.push({ file, ...imageRole(caption) });
		} else if (name === 'urls.txt') {
			job.input.urls = (await readFile(src, 'utf8')).split(/\s+/).filter((u) => /^https?:\/\//.test(u));
		} else if (name === 'notas.txt' || name === 'notes.txt') {
			job.input.notes = (await readFile(src, 'utf8')).trim();
		}
	}
	if (!job.input.audio) throw new Error(`no audio file in ${inputDir}`);
	await saveJob(config, job);
	return job;
}

async function loadSite(config: Config): Promise<SiteConfig> {
	const raw = parse(await readFile(join(config.blog.path, 'src/content/site.yaml'), 'utf8'));
	return SiteConfig.parse(raw);
}

function applyTerms(text: string, terms: UncertainTerm[]): string {
	let out = text;
	for (const t of terms) out = out.split(`[${t.guess}]`).join(t.confirmed ?? t.guess);
	return out;
}

/** Answered passages lose their `[?]` (the answer goes to Claude as a clarification); OMIT removes them. */
export function applyAnswers(text: string, passages: UnclearPassage[]): string {
	let out = text;
	for (const u of passages) {
		if (!u.answer) continue;
		const literal = u.passage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const marked = new RegExp(`${literal}\\s*\\[\\?\\]`, 'g');
		out = out.replace(marked, () => (u.answer === OMIT ? '' : u.passage));
	}
	return out.replace(/ {2,}/g, ' ');
}

export async function runJob(config: Config, job: Job, hooks: Hooks): Promise<Job> {
	const dir = jobDir(config, job.key);
	const work = join(config.paths.work, `twm-${job.key}`);
	await mkdir(work, { recursive: true });
	const save = () => saveJob(config, job);

	try {
		// 1. Audio + transcription, then cleanup (clean is '' until Claude has cleaned it)
		if (job.input.audio && !job.transcript) {
			hooks.log('audio → mp3 + detectando idioma…');
			const src = join(dir, job.input.audio);
			const mp3 = join(work, 'audio.mp3');
			await toMp3(src, mp3, config.audio.bitrate);
			const duration = await durationSeconds(mp3);
			if (duration > config.audio.maxSeconds) throw new Error(`audio is ${duration}s, max ${config.audio.maxSeconds}s`);
			await copyFile(mp3, join(dir, 'audio.mp3'));
			const wav = join(work, 'audio.wav');
			await toWav(src, wav);
			const started = Date.now();
			let reported = 0;
			const { lang, text } = await transcribe(config, wav, join(work, 'whisper'), (percent) => {
				if (percent < reported + 10 || percent >= 100) return;
				reported = percent - (percent % 10);
				const left = ((Date.now() - started) / percent) * (100 - percent);
				hooks.log(`transcribiendo ${reported}% · faltan ~${Math.max(1, Math.round(left / 60000))} min`);
			});
			job.audio = { lang, duration };
			// Saved before cleaning: on the Pi Whisper takes ~3.5× the audio, never redo it.
			job.transcript = { raw: text, clean: '' };
			await save();
		}
		if (job.transcript && !job.transcript.clean) {
			hooks.log(`idioma ${job.audio!.lang}, ${job.audio!.duration}s · limpiando transcripción…`);
			const cleaned = await cleanTranscript(config, job.transcript.raw);
			job.transcript.clean = cleaned.clean;
			job.terms = cleaned.uncertain_terms;
			job.unclear = cleaned.unclear;
			job.status = 'transcribed';
			await save();
		}
		if (!job.audio) throw new Error('job has no audio');

		// 2. Questions for Jesus: uncertain terms (answers grow the glossary) and unclear passages
		const waitForJesus = async () => {
			job.status = 'questions_pending';
			job.error = undefined;
			await save();
			return job;
		};
		const pending = (job.terms ?? []).filter((t) => t.confirmed === undefined);
		if (pending.length > 0) {
			const res = await hooks.confirmTerms(pending);
			if (!res) return waitForJesus();
			pending.forEach((t, i) => (t.confirmed = res.answers[i]));
			job.transcript!.clean = applyTerms(job.transcript!.clean, pending);
			if (res.fromJesus) await addToGlossary(
				pending
					.filter((t) => t.confirmed!.split(/\s+/).length <= 3)
					.map((t) => ({ term: t.confirmed!, meaning: 'confirmado por Jesus', heard: [t.heard] }))
			);
			await save();
		}
		const unclear = (job.unclear ?? []).filter((u) => u.answer === undefined);
		if (unclear.length > 0) {
			const answers = await hooks.clarify(unclear);
			if (!answers) return waitForJesus();
			unclear.forEach((u, i) => (u.answer = answers[i].trim()));
			job.transcript!.clean = applyAnswers(job.transcript!.clean, unclear);
			await save();
		}

		// 3. Sources
		if (job.input.urls.length > 0 && !job.sources) {
			hooks.log(`leyendo ${job.input.urls.length} URL(s)…`);
			job.sources = await Promise.all(job.input.urls.map(readSource));
			for (const s of job.sources.filter((s) => s.error)) hooks.log(`⚠ no pude leer ${s.url}: ${s.error}`);
			await save();
		}

		// 4. Images → WebP, alt described from the image itself
		for (const [n, img] of job.input.images.entries()) {
			if (img.alt) continue;
			hooks.log(`describiendo imagen ${n + 1}/${job.input.images.length}…`);
			await mkdir(join(dir, 'images'), { recursive: true });
			img.webp = `images/${n + 1}.webp`;
			await (img.role === 'cover' ? toCover : toBodyImage)(join(dir, img.file), join(dir, img.webp), config);
			img.alt = await describeImage(config, join(dir, img.webp), img.caption, job.audio.lang);
			await save();
		}

		// 5. Draft in the spoken language, then adapt
		const site = await loadSite(config);
		if (!job.draft) {
			hooks.log('redactando…');
			const original = await draftOriginal(config, job, site);
			hooks.log('adaptando al otro idioma…');
			const adapted = await adapt(config, original, job.audio.lang);
			job.draft = { original, adapted };
			job.postId = postId(job.stamp, original.idSlug);
			job.status = 'drafted';
			await save();
		}

		// 6. Self-review against the transcript and sources
		if (!job.review) {
			hooks.log('autorrevisión…');
			const { original, adapted } = job.draft;
			const lang = job.audio.lang;
			const bodies = lang === 'es' ? { es: original.body, en: adapted.body } : { es: adapted.body, en: original.body };
			const res = await review(config, job, bodies);
			original.body = res[lang];
			adapted.body = res[lang === 'es' ? 'en' : 'es'];
			job.review = { removed: res.removed };
			job.status = 'reviewed';
			await save();
		}

		// 7. Post folder + validation with the blog's own rules
		hooks.log('escribiendo y validando…');
		const postDir = join(dir, 'post', job.postId!);
		await rm(postDir, { recursive: true, force: true });
		await mkdir(postDir, { recursive: true });
		if (job.publishAudio) await copyFile(join(dir, 'audio.mp3'), join(postDir, 'audio.mp3'));
		const cover = job.input.images.findLast((i) => i.role === 'cover');
		if (cover) await copyFile(join(dir, cover.webp!), join(postDir, 'cover.webp'));
		else await generateCover(job.draft.original.title, join(postDir, 'cover.webp'), config, Number(job.stamp.slice(-2)));
		const bodyImages = job.input.images.filter((i) => i.role !== 'cover');
		for (const [n, img] of bodyImages.entries()) {
			await copyFile(join(dir, img.webp!), join(postDir, `img-${n + 1}.webp`));
		}

		const { original } = job.draft;
		const tags = [...new Set(original.tags)];
		const markdown = await writePost(
			postDir,
			job.draft,
			job.audio.lang,
			{
				date: isoDate(new Date(), config.timezone), // provisional; ✅ sets the merge date
				tags,
				sourceUrls: (job.sources ?? []).filter((s) => !s.error).map((s) => s.url),
				audio: job.publishAudio ? job.audio : undefined
			},
			job.publishAudio ? job.transcript!.clean : undefined
		);

		const siteWithNewTags = { ...site, tags: [...site.tags, ...original.newTags] };
		const files = await readdir(postDir, { recursive: true });
		const { errors } = validatePostFolder({ id: job.postId!, files, markdown }, siteWithNewTags);
		const other = job.audio.lang === 'es' ? 'en' : 'es';
		errors.push(...imageErrors(job.audio.lang, original.body, files), ...imageErrors(other, job.draft.adapted.body, files));
		if (errors.length > 0) throw new Error(`post no válido:\n${errors.join('\n')}`);

		job.status = 'ready';
		job.error = undefined;
		await save();
		return job;
	} catch (e) {
		job.status = e instanceof ClaudeUnavailable ? 'paused' : 'failed';
		job.error = (e as Error).message;
		await save();
		throw e;
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
