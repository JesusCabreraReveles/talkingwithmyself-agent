// Loads config.yaml (no secrets), applies TWM_* env overrides and resolves paths.
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { isSeq, parseDocument } from 'yaml';
import { z } from 'zod';

export const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG_FILE = process.env.TWM_CONFIG ?? join(ROOT, 'config.yaml');

try {
	process.loadEnvFile('/etc/twm/agent.env');
} catch {
	try {
		process.loadEnvFile();
	} catch {}
}

const GlossaryEntry = z
	.object({
		term: z.string().min(1),
		meaning: z.string().min(1),
		heard: z.array(z.string()).default([])
	})
	.strict();
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

const Config = z
	.object({
		timezone: z.string().min(1),
		paths: z.object({ data: z.string().min(1), work: z.string().default('') }).strict(),
		blog: z.object({ path: z.string().min(1), repo: z.string().min(1), branch: z.string().min(1) }).strict(),
		git: z
			.object({
				coAuthor: z.string().default('Claude <noreply@anthropic.com>'),
				authorName: z.string().optional(),
				authorEmail: z.string().optional()
			})
			.default({ coAuthor: 'Claude <noreply@anthropic.com>' }),
		whisper: z
			.object({ bin: z.string(), model: z.string(), threads: z.coerce.number().int().positive() })
			.strict(),
		audio: z.object({ bitrate: z.string(), maxSeconds: z.coerce.number().positive() }).strict(),
		images: z
			.object({
				maxWidth: z.coerce.number().int().positive(),
				quality: z.coerce.number().int().min(1).max(100)
			})
			.strict(),
		claude: z
			.object({ bin: z.string(), model: z.string(), retries: z.coerce.number().int().min(0) })
			.strict(),
		cover: z.object({ accent: z.string(), background: z.array(z.string()).min(1) }).strict(),
		glossary: z.array(GlossaryEntry).default([])
	})
	.strict();
export type Config = z.infer<typeof Config>;

function expandPath(p: string): string {
	if (p.startsWith('~/')) return join(homedir(), p.slice(2));
	return isAbsolute(p) ? p : resolve(ROOT, p);
}

/** TWM_WHISPER_MODEL=… overrides whisper.model (scalars only). */
function applyEnv(node: Record<string, unknown>, prefix = 'TWM'): void {
	for (const [key, value] of Object.entries(node)) {
		const name = `${prefix}_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			applyEnv(value as Record<string, unknown>, name);
		} else if (process.env[name] !== undefined) {
			node[key] = process.env[name];
		}
	}
}

export async function loadConfig(): Promise<Config> {
	const raw = parseDocument(await readFile(CONFIG_FILE, 'utf8')).toJS();
	applyEnv(raw);
	const result = Config.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
		throw new Error(`invalid ${CONFIG_FILE}:\n${issues.join('\n')}`);
	}
	const config = result.data;
	config.paths.data = expandPath(config.paths.data);
	config.paths.work = config.paths.work ? expandPath(config.paths.work) : tmpdir();
	config.blog.path = expandPath(config.blog.path);
	config.whisper.model = expandPath(config.whisper.model);
	return config;
}

/**
 * Adds confirmed terms to `glossary` (or new `heard` spellings to a known term),
 * keeping the file's comments and order. Writes only when something changed.
 */
export async function addToGlossary(entries: GlossaryEntry[]): Promise<void> {
	const doc = parseDocument(await readFile(CONFIG_FILE, 'utf8'));
	const current: GlossaryEntry[] = doc.toJS().glossary ?? [];
	let changed = false;
	for (const entry of entries) {
		const i = current.findIndex((e) => e.term.toLowerCase() === entry.term.toLowerCase());
		if (i === -1) {
			const node = doc.createNode(entry);
			const heard = node.get('heard', true);
			if (isSeq(heard)) heard.flow = true;
			doc.addIn(['glossary'], node);
			current.push(entry);
			changed = true;
			continue;
		}
		for (const heard of entry.heard) {
			if (current[i].heard.some((h) => h.toLowerCase() === heard.toLowerCase())) continue;
			doc.addIn(['glossary', i, 'heard'], heard);
			current[i].heard.push(heard);
			changed = true;
		}
	}
	if (changed) await writeFile(CONFIG_FILE, doc.toString({ flowCollectionPadding: false }));
}
