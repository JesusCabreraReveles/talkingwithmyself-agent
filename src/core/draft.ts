// The Claude steps: clean the transcript, draft in the spoken language, adapt to the
// other one, and check every claim against what Jesus actually said.
import { z } from 'zod';
import { ask, loadPrompt } from '../claude.ts';
import type { Config } from '../config.ts';
import type { InputImage, Job } from './job.ts';
import type { Lang } from './schema/post.ts';
import type { SiteConfig } from './schema/site.ts';

const Term = z.object({ heard: z.string(), guess: z.string(), why: z.string() });

const Cleaned = z.object({ clean: z.string().min(1), uncertain_terms: z.array(Term) });

const Localized = z.object({
	title: z.string().min(1).max(120),
	slug: z.string().max(50),
	description: z.string().min(1).max(200),
	hashtags: z.array(z.string()).max(10),
	coverAlt: z.string().min(1),
	body: z.string().min(1)
});
export type Localized = z.infer<typeof Localized>;

const Original = Localized.extend({
	idSlug: z.string().max(30),
	tags: z.array(z.string()).min(1).max(5),
	newTags: z.array(z.object({ id: z.string(), label: z.object({ en: z.string(), es: z.string() }) })),
	omitted: z.array(z.string())
});
export type Original = z.infer<typeof Original>;

const Reviewed = z.object({ removed: z.array(z.string()), es: z.string(), en: z.string() });

const tag = (name: string, attrs: string, body: string) => `<${name}${attrs}>\n${body}\n</${name}>`;

function glossaryBlock(config: Config): string {
	return tag('glosario', '', JSON.stringify(config.glossary, null, 1));
}

function materialBlock(job: Job): string {
	const parts = [tag('transcripcion', ` idioma="${job.audio!.lang}"`, job.transcript!.clean)];
	if (job.input.notes) parts.push(tag('notas_de_jesus', '', job.input.notes));
	for (const s of job.sources ?? []) {
		if (!s.error) parts.push(tag('fuente', ` url="${s.url}" titulo="${s.title.replace(/"/g, "'")}"`, s.text));
	}
	return parts.join('\n\n');
}

async function system(name: string): Promise<string> {
	return (await loadPrompt(name)).replace('{{voice}}', await loadPrompt('voice'));
}

export async function cleanTranscript(config: Config, raw: string) {
	return ask(config, {
		system: await loadPrompt('clean'),
		input: `${glossaryBlock(config)}\n\n${tag('transcripcion_whisper', '', raw)}`,
		schema: Cleaned
	});
}

function imagesBlock(images: InputImage[]): string {
	const body = images.filter((i) => i.role !== 'cover');
	const cover = images.findLast((i) => i.role === 'cover');
	const lines = body.map(
		(img, n) =>
			`- ./img-${n + 1}.webp · posición: ${typeof img.role === 'number' ? img.role : 'libre'} · caption: ${img.caption || '(sin caption)'}`
	);
	lines.push(cover ? `- portada enviada por Jesus · caption: ${cover.caption || '(sin caption)'}` : '- portada: generada');
	return tag('imagenes', '', lines.join('\n'));
}

export async function draftOriginal(config: Config, job: Job, site: SiteConfig): Promise<Original> {
	const tags = site.tags.map((t) => `- ${t.id}: ${t.label.es} / ${t.label.en}`).join('\n');
	return ask(config, {
		system: await system('draft'),
		input: [materialBlock(job), imagesBlock(job.input.images), tag('tags_del_blog', '', tags)].join('\n\n'),
		schema: Original
	});
}

export async function adapt(config: Config, post: Localized, from: Lang): Promise<Localized> {
	const to = from === 'es' ? 'en' : 'es';
	return ask(config, {
		system: await system('adapt'),
		input: `Adapta de "${from}" a "${to}".\n\n${tag('post', ` idioma="${from}"`, JSON.stringify(post, null, 1))}`,
		schema: Localized
	});
}

export async function review(config: Config, job: Job, bodies: Record<Lang, string>) {
	return ask(config, {
		system: await loadPrompt('review'),
		input: [
			tag('transcripcion_whisper', '', job.transcript!.raw),
			materialBlock(job),
			tag('post_es', '', bodies.es),
			tag('post_en', '', bodies.en)
		].join('\n\n'),
		schema: Reviewed
	});
}
