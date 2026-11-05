import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clampTweet, generateDevToMarkdown, readShareFiles, writeShareFiles, type ShareTexts } from './share.ts';
import type { Localized } from './draft.ts';

test('clampTweet: preserves tweets under limit and trims at word boundary when over', () => {
	const short = 'Un tweet corto con link https://cabrera.systems/blog/es/demo #AI';
	assert.equal(clampTweet(short, 280), short);

	const longText = 'A'.repeat(250) + ' palabra ' + 'B'.repeat(50);
	const clamped = clampTweet(longText, 280);
	assert.ok(clamped.length <= 280);
	assert.ok(clamped.endsWith('…'));
});

test('generateDevToMarkdown: builds frontmatter, cleans tags, and rewrites relative images', () => {
	const post: Localized = {
		title: 'Un equipo Scrum de agentes de IA',
		description: 'Cómo orquestar agentes bajo ceremonias de Scrum.',
		slug: 'scrum-agentes-ia',
		hashtags: ['#AI', '#Scrum!', '#SoftwareEngineering', '#Agile', '#ExtraTag'],
		coverAlt: 'Portada',
		body: 'Este es el contenido.\n\n![Arquitectura](./image-1.webp)\n\nMás texto.'
	};

	const md = generateDevToMarkdown(
		post,
		'es',
		'https://cabrera.systems/blog/es/scrum-agentes-ia',
		'JesusCabreraReveles/cabrera-systems-blog',
		'202611042027-scrum-agentes-ia'
	);

	// Frontmatter assertions
	assert.ok(md.startsWith('---\n'));
	assert.ok(md.includes('title: "Un equipo Scrum de agentes de IA"'));
	assert.ok(md.includes('published: false'));
	assert.ok(md.includes('canonical_url: https://cabrera.systems/blog/es/scrum-agentes-ia'));
	assert.ok(
		md.includes(
			'cover_image: https://raw.githubusercontent.com/JesusCabreraReveles/cabrera-systems-blog/master/src/content/posts/202611042027-scrum-agentes-ia/cover.webp'
		)
	);

	// Dev.to tags: max 4, lowercase, alphanumeric only
	assert.ok(md.includes('tags: [ai, scrum, softwareengineering, agile]'));
	assert.ok(!md.includes('extratag'));

	// Relative image rewrite
	assert.ok(
		md.includes(
			'![Arquitectura](https://raw.githubusercontent.com/JesusCabreraReveles/cabrera-systems-blog/master/src/content/posts/202611042027-scrum-agentes-ia/image-1.webp)'
		)
	);
	assert.ok(!md.includes('./image-1.webp'));
});

test('writeShareFiles & readShareFiles: persists and loads the 6 share output files', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'twm-share-test-'));

	try {
		const shareTexts: ShareTexts = {
			linkedin: {
				es: 'Texto LinkedIn ES con hook y puntos clave.',
				en: 'LinkedIn text EN with key insights.'
			},
			x: {
				es: 'Tweet ES https://cabrera.systems/blog/es/test #AI',
				en: 'Tweet EN https://cabrera.systems/blog/en/test #AI'
			}
		};

		const devTo = {
			es: '---\ntitle: "ES"\n---\nCuerpo ES',
			en: '---\ntitle: "EN"\n---\nBody EN'
		};

		await writeShareFiles(dir, shareTexts, devTo);

		const loaded = await readShareFiles(dir);
		assert.ok(loaded !== null);
		assert.equal(loaded?.shareTexts.linkedin.es, shareTexts.linkedin.es);
		assert.equal(loaded?.shareTexts.linkedin.en, shareTexts.linkedin.en);
		assert.equal(loaded?.shareTexts.x.es, shareTexts.x.es);
		assert.equal(loaded?.shareTexts.x.en, shareTexts.x.en);
		assert.equal(loaded?.devTo.es, devTo.es);
		assert.equal(loaded?.devTo.en, devTo.en);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
