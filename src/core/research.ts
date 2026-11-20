// /investigar: a short web research Jesus reviews before it becomes material for the post.
import { z } from 'zod';
import { ask, loadPrompt } from '../claude.ts';
import type { Config } from '../config.ts';
import type { Research } from './job.ts';

const Result = z.object({
	summary: z.string().min(1).max(1200),
	points: z.array(z.string().min(1).max(400)).min(1).max(8),
	sources: z.array(z.object({ title: z.string().min(1), url: z.url() })).min(1).max(8)
});

export async function research(config: Config, topic: string, now = new Date()): Promise<Research> {
	const res = await ask(config, {
		system: await loadPrompt('research'),
		input: `<tema>\n${topic}\n</tema>`,
		schema: Result,
		tools: ['WebSearch', 'WebFetch']
	});
	return { topic, ...res, approved: false, createdAt: now.toISOString() };
}
