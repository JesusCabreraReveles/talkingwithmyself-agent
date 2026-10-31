// Writes the blog post folder: en.md, es.md, transcript.md (+ media written by the pipeline).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { Localized, Original } from './draft.ts';
import { SCHEMA_VERSION, type Lang, type PostFrontmatter } from './schema/post.ts';

export type Shared = {
	date: string;
	tags: string[];
	sourceUrls: string[];
	audio?: { lang: Lang; duration: number };
};

function frontmatter(post: Localized, lang: Lang, original: boolean, shared: Shared): PostFrontmatter {
	return {
		schemaVersion: SCHEMA_VERSION,
		title: post.title,
		slug: post.slug,
		lang,
		original,
		date: shared.date,
		description: post.description,
		cover: './cover.webp',
		coverAlt: post.coverAlt,
		tags: shared.tags,
		hashtags: post.hashtags.map((h) => h.replace(/^#/, '')),
		sourceUrls: shared.sourceUrls,
		draft: false,
		...(shared.audio && {
			audio: './audio.mp3',
			audioLang: shared.audio.lang,
			duration: shared.audio.duration
		})
	};
}

export function renderMarkdown(fm: PostFrontmatter, body: string): string {
	return `---\n${stringify(fm, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;
}

export async function writePost(
	dir: string,
	draft: { original: Original; adapted: Localized },
	originalLang: Lang,
	shared: Shared,
	transcript?: string
): Promise<Record<Lang, string>> {
	const otherLang: Lang = originalLang === 'es' ? 'en' : 'es';
	const files = {
		[originalLang]: renderMarkdown(frontmatter(draft.original, originalLang, true, shared), draft.original.body),
		[otherLang]: renderMarkdown(frontmatter(draft.adapted, otherLang, false, shared), draft.adapted.body)
	} as Record<Lang, string>;
	await writeFile(join(dir, 'en.md'), files.en);
	await writeFile(join(dir, 'es.md'), files.es);
	if (transcript) await writeFile(join(dir, 'transcript.md'), transcript.trim() + '\n');
	return files;
}
