// Folder-level rules that a single JSON Schema can't express.
// Pure (no fs) so the build and talkingwithmyself-agent run the same checks.
import { parse } from 'yaml';
import { LANGS, POST_ID, POST_ID_SLUG_MAX, PostFrontmatter, type Lang } from './post.ts';
import type { SiteConfig } from './site.ts';

export type PostFolder = {
	id: string;
	/** File names in the folder, relative (e.g. "cover.webp", "share/x.en.txt"). */
	files: string[];
	/** Raw contents of en.md / es.md. */
	markdown: Partial<Record<Lang, string>>;
};

export type ValidPost = {
	id: string;
	lang: Lang;
	frontmatter: PostFrontmatter;
	body: string;
};

export function splitFrontmatter(raw: string): { data: unknown; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) throw new Error('missing --- frontmatter block');
	return { data: parse(match[1]), body: match[2] };
}

export function validatePostFolder(
	folder: PostFolder,
	site: SiteConfig
): { posts: ValidPost[]; errors: string[] } {
	const errors: string[] = [];
	const err = (msg: string) => errors.push(`${folder.id}: ${msg}`);
	const posts: ValidPost[] = [];

	if (!POST_ID.test(folder.id)) err('folder id must be AAAAMMDDHHmm-<kebab-slug>');
	else if (folder.id.slice(13).length > POST_ID_SLUG_MAX) {
		err(`id slug longer than ${POST_ID_SLUG_MAX} chars`);
	}

	const tagIds = new Set(site.tags.map((t) => t.id));

	for (const lang of LANGS) {
		const raw = folder.markdown[lang];
		if (raw === undefined) {
			err(`missing ${lang}.md`);
			continue;
		}
		let split;
		try {
			split = splitFrontmatter(raw);
		} catch (e) {
			err(`${lang}.md: ${(e as Error).message}`);
			continue;
		}
		const result = PostFrontmatter.safeParse(split.data);
		if (!result.success) {
			for (const issue of result.error.issues) {
				err(`${lang}.md: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
			}
			continue;
		}
		const fm = result.data;
		if (fm.lang !== lang) err(`${lang}.md: lang is "${fm.lang}"`);
		for (const tag of fm.tags) {
			if (!tagIds.has(tag)) err(`${lang}.md: tag "${tag}" is not in src/content/site.yaml`);
		}
		for (const ref of [fm.cover, fm.audio]) {
			if (ref && !folder.files.includes(ref.slice(2))) err(`${lang}.md: ${ref} not found`);
		}
		posts.push({ id: folder.id, lang, frontmatter: fm, body: split.body });
	}

	if (posts.length === LANGS.length) {
		const originals = posts.filter((p) => p.frontmatter.original);
		if (originals.length !== 1) err('exactly one language must have original: true');

		const shared = ['date', 'cover', 'tags', 'draft', 'audio', 'audioLang', 'duration'] as const;
		for (const key of shared) {
			const values = posts.map((p) => JSON.stringify(p.frontmatter[key]));
			if (new Set(values).size > 1) err(`${key} differs between en.md and es.md`);
		}

		const audioLang = posts[0].frontmatter.audioLang;
		if (audioLang) {
			if (!folder.files.includes('transcript.md')) err('audio without transcript.md');
			if (originals.length === 1 && originals[0].lang !== audioLang) {
				err(`audioLang is "${audioLang}" but the original is "${originals[0].lang}"`);
			}
		}
	}

	return { posts, errors };
}

/** Slugs must be unique per language across all posts. */
export function validateSlugs(posts: ValidPost[]): string[] {
	const seen = new Map<string, string>();
	const errors: string[] = [];
	for (const p of posts) {
		const key = `${p.lang}/${p.frontmatter.slug}`;
		const other = seen.get(key);
		if (other) errors.push(`${p.id}: slug ${key} already used by ${other}`);
		else seen.set(key, p.id);
	}
	return errors;
}
