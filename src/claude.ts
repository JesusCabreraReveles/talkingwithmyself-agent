// Claude through the subscription: `claude -p` headless, with no tools, MCP, settings
// or session, so a prompt (or a web page quoted in it) can only produce text.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { ROOT, type Config } from './config.ts';

export class ClaudeUnavailable extends Error {}

export async function loadPrompt(name: string): Promise<string> {
	return readFile(join(ROOT, 'prompts', `${name}.md`), 'utf8');
}

function run(bin: string, args: string[], input: string): Promise<string> {
	return new Promise((resolve, reject) => {
		// Neutral cwd: no project CLAUDE.md is picked up.
		const child = spawn(bin, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (err += d));
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(out);
			else reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(0, 500)}`));
		});
		child.stdin.end(input);
	});
}

/** One user turn with images, for --input-format stream-json. */
async function imageMessage(input: string, images: string[]): Promise<string> {
	const content: unknown[] = [];
	for (const file of images) {
		const data = (await readFile(file)).toString('base64');
		content.push({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data } });
	}
	content.push({ type: 'text', text: input });
	return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

/**
 * Sends `input` with the system prompt `system` and returns the structured output
 * validated against `schema`. `images` (WebP files) go in the same turn. Retries,
 * then throws ClaudeUnavailable so the job can pause.
 */
export async function ask<T extends z.ZodType>(
	config: Config,
	opts: { system: string; input: string; schema: T; images?: string[] }
): Promise<z.infer<T>> {
	// claude's validator doesn't resolve the draft-2020-12 meta-schema URI.
	const { $schema: _, ...schema } = z.toJSONSchema(opts.schema);
	const jsonSchema = JSON.stringify(schema);
	const args = [
		'-p',
		'--model', config.claude.model,
		'--tools', '',
		'--strict-mcp-config',
		'--setting-sources', '',
		'--disable-slash-commands',
		'--no-session-persistence',
		'--system-prompt', opts.system,
		'--json-schema', jsonSchema,
		...(opts.images?.length
			? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
			: ['--output-format', 'json'])
	];
	const input = opts.images?.length ? await imageMessage(opts.input, opts.images) : opts.input;

	let lastError: unknown;
	for (let attempt = 0; attempt <= config.claude.retries; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * 2 ** (attempt - 1)));
		try {
			// stream-json ends with the same result object that json prints alone.
			const out = (await run(config.claude.bin, args, input)).trim();
			const res = JSON.parse(out.slice(out.lastIndexOf('\n') + 1));
			if (res.is_error) throw new Error(`claude: ${res.subtype}: ${res.result ?? ''}`);
			const data = res.structured_output ?? JSON.parse(res.result);
			return opts.schema.parse(data);
		} catch (e) {
			lastError = e;
		}
	}
	throw new ClaudeUnavailable((lastError as Error)?.message ?? 'unknown error');
}
