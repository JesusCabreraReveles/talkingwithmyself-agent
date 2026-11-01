// whisper.cpp → language + raw text. The language is detected first, then the
// glossary goes in as a natural sentence in that language: a bare "Glossary: …" list
// as prompt made Whisper worse (it misheard "a mí se me ocurría" as "cuando ocurría").
import { readFile } from 'node:fs/promises';
import type { Config } from '../config.ts';
import { execBoth, execStream } from './exec.ts';
import type { Lang } from './schema/post.ts';

const PROMPT: Record<Lang, (terms: string) => string> = {
	es: (terms) => `Hablo de ${terms}.`,
	en: (terms) => `I talk about ${terms}.`
};

async function detectLanguage(config: Config, wav: string): Promise<Lang> {
	const { stderr } = await execBoth(config.whisper.bin, [
		'-m', config.whisper.model, '-f', wav, '-l', 'auto', '--detect-language', '-t', String(config.whisper.threads)
	]);
	const lang = /auto-detected language: (\w+)/.exec(stderr)?.[1];
	if (lang !== 'es' && lang !== 'en') throw new Error(`unsupported audio language "${lang}"`);
	return lang;
}

export async function transcribe(
	config: Config,
	wav: string,
	outBase: string,
	onProgress: (percent: number) => void = () => {}
): Promise<{ lang: Lang; text: string }> {
	const lang = await detectLanguage(config, wav);
	const args = ['-m', config.whisper.model, '-f', wav, '-l', lang, '-t', String(config.whisper.threads)];
	const terms = config.glossary.map((g) => g.term).join(', ');
	if (terms) args.push('--prompt', PROMPT[lang](terms));
	await execStream(config.whisper.bin, [...args, '-oj', '-of', outBase, '-pp'], (line) => {
		const percent = /progress =\s*(\d+)%/.exec(line)?.[1];
		if (percent) onProgress(Number(percent));
	});

	const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8'));
	const text = json.transcription.map((s: { text: string }) => s.text.trim()).join('\n');
	return { lang, text };
}
