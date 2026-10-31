// URLs Jesus sends → readable text. Content is quoted to Claude as a source, never as instructions.
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const MAX_CHARS = 20_000;

export type Source = { url: string; title: string; text: string; error?: string };

export async function readSource(url: string): Promise<Source> {
	try {
		const res = await fetch(url, {
			headers: { 'user-agent': 'Mozilla/5.0 (talkingwithmyself-agent)' },
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const type = res.headers.get('content-type') ?? '';
		if (!type.includes('html')) throw new Error(`unsupported content-type ${type}`);
		const { document } = parseHTML(await res.text());
		const article = new Readability(document as unknown as Document).parse();
		const text = article?.textContent?.replace(/\s+\n/g, '\n').trim() ?? '';
		if (!text) throw new Error('no readable text');
		return { url, title: article?.title ?? url, text: text.slice(0, MAX_CHARS) };
	} catch (e) {
		return { url, title: url, text: '', error: (e as Error).message };
	}
}
