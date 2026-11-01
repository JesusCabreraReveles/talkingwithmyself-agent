#!/usr/bin/env node
// twm draft <input-dir> [--yes] [--audio]   new post from a folder (audio + images + urls.txt + notas.txt);
//                                    --audio also publishes the voice note and its transcript
// twm resume <job> [--yes] [--answer=<term>…] [--clarify=<text>…]   continue a paused / pending job;
//                                    --answer gives the pending terms' spellings in order,
//                                    --clarify what each [?] passage meant ('omitir' drops it)
// twm status <job>                show a job's state
// twm covers "<title>"            render every generated-cover variant to data/covers/
import { createInterface } from 'node:readline/promises';
import { mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { loadConfig, type Config } from './config.ts';
import { jobDir, loadJob, OMIT, type Job, type UncertainTerm, type UnclearPassage } from './core/job.ts';
import { COVER_VARIANTS, generateCover } from './core/images.ts';
import { createJob, runJob, type Hooks } from './core/pipeline.ts';

const [command, arg, ...flags] = process.argv.slice(2);
const yes = flags.includes('--yes');
const publishAudio = flags.includes('--audio');
const values = (name: string) => flags.filter((f) => f.startsWith(`--${name}=`)).map((f) => f.slice(name.length + 3));
const answersFlag = values('answer');
const clarifyFlag = values('clarify');

async function confirmTerms(terms: UncertainTerm[]) {
	if (answersFlag.length === terms.length) return { answers: answersFlag, fromJesus: true };
	if (yes) return { answers: terms.map((t) => t.guess), fromJesus: false };
	if (!process.stdin.isTTY) return null;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	console.log('\nTérminos dudosos (Enter = aceptar la hipótesis, o escribe el correcto):');
	const answers: string[] = [];
	for (const t of terms) {
		console.log(`\n  se escuchó: "${t.heard}"\n  ${t.why}`);
		const answer = (await rl.question(`  ¿${t.guess}? `)).trim();
		answers.push(answer || t.guess);
	}
	rl.close();
	return { answers, fromJesus: true };
}

async function clarify(passages: UnclearPassage[]) {
	if (clarifyFlag.length === passages.length) return clarifyFlag;
	if (yes) return passages.map(() => ''); // stay doubtful: never stated as fact
	if (!process.stdin.isTTY) return null;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	console.log(`\nPasajes que no se entendieron (Enter = dejarlo como dudoso, "${OMIT}" = quitarlo):`);
	const answers: string[] = [];
	for (const u of passages) {
		console.log(`\n  «${u.passage}»`);
		answers.push((await rl.question(`  ${u.question} `)).trim());
	}
	rl.close();
	return answers;
}

function report(config: Config, job: Job): void {
	console.log(`\njob ${job.key} · ${job.status}${job.error ? ` · ${job.error}` : ''}`);
	if (job.status === 'questions_pending') {
		for (const t of (job.terms ?? []).filter((t) => t.confirmed === undefined)) console.log(`término: "${t.heard}" → ¿${t.guess}?`);
		for (const u of (job.unclear ?? []).filter((u) => u.answer === undefined)) console.log(`pasaje: «${u.passage}» → ${u.question}`);
		console.log(`preguntas pendientes → twm resume ${job.key}`);
	}
	if (job.status === 'paused') console.log(`Claude no disponible → twm resume ${job.key}`);
	if (!job.draft) return;
	const { original, adapted } = job.draft;
	console.log(`\n${original.title}\n${adapted.title}`);
	console.log(`tags: ${original.tags.join(', ')}${original.newTags.length ? ` (nuevos: ${original.newTags.map((t) => t.id).join(', ')})` : ''}`);
	for (const o of original.omitted) console.log(`omitido: ${o}`);
	for (const r of job.review?.removed ?? []) console.log(`quitado en revisión: ${r}`);
	if (job.status === 'ready') {
		console.log(`\npost: ${relative(process.cwd(), `${jobDir(config, job.key)}/post/${job.postId}`)}`);
	}
}

const hooks: Hooks = { log: (m) => console.log(`· ${m}`), confirmTerms, clarify };

async function main(): Promise<void> {
	const config = await loadConfig();
	let job: Job;
	switch (command) {
		case 'draft':
			if (!arg) throw new Error('usage: twm draft <input-dir> [--yes] [--audio]');
			job = await createJob(config, arg, { publishAudio });
			console.log(`job ${job.key}`);
			break;
		case 'covers': {
			if (!arg) throw new Error('usage: twm covers "<title>"');
			const out = join(config.paths.data, 'covers');
			await mkdir(out, { recursive: true });
			const total = COVER_VARIANTS * config.cover.background.length;
			for (let v = 0; v < total; v++) await generateCover(arg, join(out, `variant-${v}.webp`), config, v);
			console.log(`${total} variantes → ${relative(process.cwd(), out)}`);
			return;
		}
		case 'resume':
		case 'status':
			if (!arg) throw new Error(`usage: twm ${command} <job>`);
			job = await loadJob(config, arg);
			if (command === 'status') return report(config, job);
			break;
		default:
			console.log('usage: twm draft <input-dir> [--yes] [--audio] | twm resume <job> [--yes] | twm status <job> | twm covers "<title>"');
			process.exit(command ? 1 : 0);
	}
	try {
		job = await runJob(config, job, hooks);
	} finally {
		report(config, job);
	}
}

main().catch((e) => {
	console.error(`\n✗ ${(e as Error).message}`);
	process.exit(1);
});
