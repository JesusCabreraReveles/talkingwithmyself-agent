// Stage 5: Generation of share outputs for LinkedIn, X (Twitter), Dev.to / Hashnode,
// and optional audiogram MP4 for Telegram.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ask, loadPrompt } from '../claude.ts';
import type { Config } from '../config.ts';
import { exec } from './exec.ts';
import { jobDir, type Job } from './job.ts';
import type { Localized } from './draft.ts';
import type { Lang } from './schema/post.ts';

export const ShareTexts = z.object({
	linkedin: z.object({
		es: z.string().min(1),
		en: z.string().min(1)
	}),
	x: z.object({
		es: z.string().min(1).max(400),
		en: z.string().min(1).max(400)
	})
});
export type ShareTexts = z.infer<typeof ShareTexts>;

/**
 * Ensures tweet fits within maxLen (default 280) without breaking words if possible.
 */
export function clampTweet(text: string, maxLen = 280): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLen) return trimmed;
	const sliced = trimmed.slice(0, maxLen - 1);
	const lastSpace = sliced.lastIndexOf(' ');
	if (lastSpace > maxLen - 30) {
		return `${sliced.slice(0, lastSpace)}…`;
	}
	return `${sliced}…`;
}

const tag = (name: string, attrs: string, body: string) => `<${name}${attrs}>\n${body}\n</${name}>`;

export async function generateShareTexts(
	config: Config,
	job: Job,
	urls: { en: string; es: string }
): Promise<ShareTexts> {
	if (!job.draft) throw new Error('No draft found on job');

	const orig = job.draft.original;
	const adapt = job.draft.adapted;
	const esPost = job.audio?.lang === 'es' ? orig : adapt;
	const enPost = job.audio?.lang === 'en' ? orig : adapt;

	const input = [
		tag(
			'post_es',
			'',
			[
				`Título: ${esPost.title}`,
				`Descripción: ${esPost.description}`,
				`URL canónica: ${urls.es}`,
				`Hashtags: ${esPost.hashtags.join(', ')}`,
				`Ideas clave: ${esPost.body.slice(0, 500)}`
			].join('\n')
		),
		tag(
			'post_en',
			'',
			[
				`Title: ${enPost.title}`,
				`Description: ${enPost.description}`,
				`Canonical URL: ${urls.en}`,
				`Hashtags: ${enPost.hashtags.join(', ')}`,
				`Key ideas: ${enPost.body.slice(0, 500)}`
			].join('\n')
		)
	].join('\n\n');

	const res = await ask(config, {
		system: await loadPrompt('share'),
		input,
		schema: ShareTexts
	});

	return {
		linkedin: {
			es: res.linkedin.es.trim(),
			en: res.linkedin.en.trim()
		},
		x: {
			es: clampTweet(res.x.es),
			en: clampTweet(res.x.en)
		}
	};
}

/**
 * Builds Dev.to / Hashnode frontmatter and replaces relative image references with raw GitHub URLs.
 */
export function generateDevToMarkdown(
	post: Localized,
	lang: Lang,
	canonicalUrl: string,
	repo: string,
	postId: string
): string {
	const rawBase = `https://raw.githubusercontent.com/${repo}/master/src/content/posts/${postId}`;
	const coverUrl = `${rawBase}/cover.webp`;

	// Tags for Dev.to: max 4, alphanumeric
	const devTags = post.hashtags
		.map((h) => h.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
		.filter(Boolean)
		.slice(0, 4);

	const frontmatter = [
		'---',
		`title: "${post.title.replace(/"/g, '\\"')}"`,
		'published: false',
		`description: "${post.description.replace(/"/g, '\\"')}"`,
		`tags: [${devTags.join(', ')}]`,
		`canonical_url: ${canonicalUrl}`,
		`cover_image: ${coverUrl}`,
		'---',
		''
	].join('\n');

	// Replace relative images ![alt](./img-1.webp) -> ![alt](rawBase/img-1.webp)
	let body = post.body.replace(/!\[([^\]]*)\]\(\.\/([^)\s]+)\)/g, (_match, alt, file) => {
		return `![${alt}](${rawBase}/${file})`;
	});

	return `${frontmatter}\n${body.trim()}\n`;
}

/**
 * Writes the 6 share output files under postDir/share/.
 */
export async function writeShareFiles(
	postDir: string,
	shareTexts: ShareTexts,
	devTo: { en: string; es: string }
): Promise<void> {
	const shareDir = join(postDir, 'share');
	await mkdir(shareDir, { recursive: true });

	await writeFile(join(shareDir, 'linkedin.es.txt'), shareTexts.linkedin.es.trim() + '\n');
	await writeFile(join(shareDir, 'linkedin.en.txt'), shareTexts.linkedin.en.trim() + '\n');
	await writeFile(join(shareDir, 'x.es.txt'), shareTexts.x.es.trim() + '\n');
	await writeFile(join(shareDir, 'x.en.txt'), shareTexts.x.en.trim() + '\n');
	await writeFile(join(shareDir, 'devto.es.md'), devTo.es.trim() + '\n');
	await writeFile(join(shareDir, 'devto.en.md'), devTo.en.trim() + '\n');
}

/**
 * Attempts to read existing share output files from postDir/share/ or shareDir.
 */
export async function readShareFiles(
	dir: string
): Promise<{ shareTexts: ShareTexts; devTo: { en: string; es: string } } | null> {
	const shareDir = dir.endsWith('/share') ? dir : join(dir, 'share');
	try {
		const [linkedinEs, linkedinEn, xEs, xEn, devtoEs, devtoEn] = await Promise.all([
			readFile(join(shareDir, 'linkedin.es.txt'), 'utf8'),
			readFile(join(shareDir, 'linkedin.en.txt'), 'utf8'),
			readFile(join(shareDir, 'x.es.txt'), 'utf8'),
			readFile(join(shareDir, 'x.en.txt'), 'utf8'),
			readFile(join(shareDir, 'devto.es.md'), 'utf8'),
			readFile(join(shareDir, 'devto.en.md'), 'utf8')
		]);
		return {
			shareTexts: {
				linkedin: { es: linkedinEs.trim(), en: linkedinEn.trim() },
				x: { es: xEs.trim(), en: xEn.trim() }
			},
			devTo: { es: devtoEs.trim(), en: devtoEn.trim() }
		};
	} catch {
		return null;
	}
}

/**
 * Renders a square 1080x1080 audiogram MP4 using ffmpeg.
 * Waveform in accent color #f97316 overlayed on the square cover image, audio max 140s.
 */
export async function generateAudiogram(
	config: Config,
	job: Job,
	outPath: string,
	hooks?: { log: (msg: string) => void },
	options: { maxDurationSec?: number } = {}
): Promise<string | null> {
	const dir = jobDir(config, job.key);
	const audioPath = existsSync(join(dir, 'audio.mp3'))
		? join(dir, 'audio.mp3')
		: job.input.audio && existsSync(join(dir, job.input.audio))
			? join(dir, job.input.audio)
			: null;

	if (!audioPath) return null;

	let coverPath = job.postId ? join(dir, 'post', job.postId, 'cover.webp') : null;
	if (!coverPath || !existsSync(coverPath)) {
		coverPath = join(config.blog.path, 'src/content/posts', job.postId ?? '', 'cover.webp');
	}
	if (!existsSync(coverPath)) return null;

	const maxSec = options.maxDurationSec ?? 140;
	hooks?.log(`renderizando audiograma MP4 con ffmpeg (≤ ${maxSec}s)…`);

	const args = [
		'-y',
		'-loop',
		'1',
		'-i',
		coverPath,
		'-i',
		audioPath,
		'-filter_complex',
		'[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080[bg];[1:a]showwaves=s=920x160:mode=line:colors=0xf97316[wave];[bg][wave]overlay=(W-w)/2:H-h-100[v]',
		'-map',
		'[v]',
		'-map',
		'1:a',
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		'-pix_fmt',
		'yuv420p',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-t',
		String(maxSec),
		outPath
	];

	await exec('ffmpeg', args);
	hooks?.log(`audiograma completado: ${outPath}`);
	return outPath;
}
