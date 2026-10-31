// Frontmatter of src/content/posts/<id>/{en,es}.md.
// Contract with talkingwithmyself-agent. v1 frozen on 2026-10-31: any breaking change bumps SCHEMA_VERSION.
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const LANGS = ['en', 'es'] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

// AAAAMMDDHHmm-<english-slug>, slug ≤ 30 chars. The date in the id is never read.
export const POST_ID = /^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const POST_ID_SLUG_MAX = 30;

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const localFile = (ext: string) => new RegExp(`^\\./[a-z0-9]+(?:-[a-z0-9]+)*\\.${ext}$`);

export const PostFrontmatter = z
	.object({
		schemaVersion: z.literal(SCHEMA_VERSION),
		title: z.string().trim().min(1).max(120),
		slug: z.string().max(50).regex(kebab, 'kebab-case: a-z, 0-9 and single dashes'),
		lang: Lang,
		original: z.boolean().describe('true in the language Jesus spoke/wrote in'),
		date: z.iso.date().describe('YYYY-MM-DD, America/Mexico_City. Merge date; provisional on branches'),
		description: z.string().trim().min(1).max(200).describe('Meta description and excerpt'),
		cover: z.string().regex(localFile('webp')).describe('e.g. ./cover.webp'),
		coverAlt: z.string().trim().min(1),
		tags: z
			.array(z.string().regex(kebab))
			.min(1)
			.max(5)
			.describe('Tag ids from src/content/site.yaml'),
		hashtags: z
			.array(z.string().regex(/^[\p{L}\p{N}_]+$/u, 'without #'))
			.max(10)
			.default([])
			.describe('For social networks, per language, without #'),
		sourceUrls: z.array(z.url()).default([]),
		draft: z.boolean().default(false),
		audio: z.string().regex(localFile('mp3')).optional().describe('e.g. ./audio.mp3'),
		audioLang: Lang.optional().describe('Language spoken in the audio and transcript.md'),
		duration: z.int().positive().optional().describe('Audio length in seconds')
	})
	.strict()
	.superRefine((post, ctx) => {
		const audioFields = [post.audio, post.audioLang, post.duration];
		if (audioFields.some((v) => v !== undefined) && audioFields.some((v) => v === undefined)) {
			ctx.addIssue({
				code: 'custom',
				message: 'audio, audioLang and duration go together',
				path: ['audio']
			});
		}
	});

export type PostFrontmatter = z.infer<typeof PostFrontmatter>;
