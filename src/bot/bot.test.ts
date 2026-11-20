import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { loadSession, saveSession, clearSession } from './session.ts';
import { formatPreviewMessage } from './ui.ts';
import type { Job } from '../core/job.ts';

test('bot session: loads, saves, and clears active session state', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'twm-bot-test-'));
	const config = await loadConfig();
	config.paths.data = dir;

	const empty = await loadSession(config);
	assert.equal(empty.activeJobKey, null);

	await saveSession(config, { activeJobKey: '202611041200' });
	const loaded = await loadSession(config);
	assert.equal(loaded.activeJobKey, '202611041200');

	await clearSession(config);
	const cleared = await loadSession(config);
	assert.equal(cleared.activeJobKey, null);

	await rm(dir, { recursive: true, force: true });
});

test('bot ui: formatPreviewMessage builds formatted HTML output', () => {
	const dummyJob: Job = {
		key: '202611041200',
		stamp: '202611041200',
		createdAt: new Date().toISOString(),
		status: 'previewed',
		publishAudio: false,
		input: { images: [], urls: [], notes: '' },
		audio: { lang: 'es', duration: 120 },
		draft: {
			original: {
				title: 'Mi post en español',
				slug: 'mi-post-en-espanol',
				idSlug: 'mi-post',
				description: 'Descripción',
				hashtags: ['Tech'],
				coverAlt: 'Portada',
				body: 'Cuerpo',
				tags: ['tec'],
				newTags: [],
				omitted: []
			},
			adapted: {
				title: 'My post in English',
				slug: 'my-post-in-english',
				description: 'Description',
				hashtags: ['Tech'],
				coverAlt: 'Cover',
				body: 'Body'
			}
		},
		publish: {
			branch: 'post/202611041200-mi-post',
			prNumber: 42,
			prUrl: 'https://github.com/owner/repo/pull/42',
			previewUrl: 'https://preview.vercel.app'
		}
	};

	const formatted = formatPreviewMessage(dummyJob);
	assert.ok(formatted.includes('Mi post en español'));
	assert.ok(formatted.includes('My post in English'));
	assert.ok(formatted.includes('https://preview.vercel.app'));
	assert.ok(formatted.includes('PR #42'));
});

test('bot ui: formatResearch escapes HTML and stays under the Telegram limit', async () => {
	const { formatResearch } = await import('./ui.ts');
	const r = {
		topic: 'A2A <vs> MCP',
		summary: 'Resumen & contexto',
		points: Array.from({ length: 8 }, (_, i) => `Punto ${i} ` + 'x'.repeat(700)),
		sources: Array.from({ length: 8 }, (_, i) => ({ title: `Fuente ${i}`, url: `https://example.com/${i}?a=1&b=2` })),
		approved: false,
		createdAt: new Date().toISOString()
	};
	const text = formatResearch(r);
	assert.ok(text.length <= 4000, `length ${text.length}`);
	assert.ok(text.includes('A2A &lt;vs&gt; MCP'));
	assert.ok(text.includes('Resumen &amp; contexto'));
	assert.ok(text.includes('Punto 0'));
	assert.ok(text.includes('href="https://example.com/7?a=1&amp;b=2"'));
	assert.ok(!text.includes('Punto 7'));
});

test('draft: only approved research counts as material', async () => {
	const { approvedResearch } = await import('../core/draft.ts');
	const base = { summary: 's', points: ['p'], sources: [{ title: 't', url: 'https://e.com' }], createdAt: '' };
	const job = {
		research: [
			{ ...base, topic: 'sí', approved: true },
			{ ...base, topic: 'no', approved: false }
		]
	} as Job;
	assert.deepEqual(approvedResearch(job).map((r) => r.topic), ['sí']);
	assert.deepEqual(approvedResearch({} as Job), []);
});
