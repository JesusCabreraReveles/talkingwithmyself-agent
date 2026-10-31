// src/content/site.yaml: editorial config owned by the blog.
// talkingwithmyself-agent only edits the `tags` section.
import { z } from 'zod';
import { LANGS, Lang } from './post.ts';

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const Localized = z.object({ en: z.string().trim().min(1), es: z.string().trim().min(1) }).strict();

export const SiteConfig = z
	.object({
		title: z.string().trim().min(1),
		tagline: Localized,
		baseUrl: z.url().describe('Canonical base, no trailing slash'),
		languages: z.array(Lang).min(1).default([...LANGS]),
		author: z.object({ name: z.string().trim().min(1), url: z.url() }).strict(),
		social: z.object({ x: z.string().regex(/^\w{1,15}$/, 'handle without @') }).strict(),
		links: z
			.array(z.object({ id: z.string().regex(kebab), label: Localized, url: z.url() }).strict())
			.default([]),
		tags: z.array(z.object({ id: z.string().regex(kebab), label: Localized }).strict())
	})
	.strict()
	.superRefine((site, ctx) => {
		const seen = new Set<string>();
		site.tags.forEach((tag, i) => {
			if (seen.has(tag.id)) {
				ctx.addIssue({ code: 'custom', message: `duplicate tag "${tag.id}"`, path: ['tags', i, 'id'] });
			}
			seen.add(tag.id);
		});
	});

export type SiteConfig = z.infer<typeof SiteConfig>;
