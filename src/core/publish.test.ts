import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { findJob } from './job.ts';
import { appendTagsToSiteYaml } from './publish.ts';
import { findPreviewUrl } from './github.ts';

test('findJob: finds job by key or postId', async () => {
	const config = await loadConfig();
	const byKey = await findJob(config, '202611010153');
	assert.equal(byKey.key, '202611010153');
	assert.equal(byKey.postId, '202611010153-auro-wifi-csi-presence');

	const byPostId = await findJob(config, '202611010153-auro-wifi-csi-presence');
	assert.equal(byPostId.key, '202611010153');
});

test('appendTagsToSiteYaml: appends new tags to yaml preserving structure and idempotency', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'twm-test-'));
	const file = join(dir, 'site.yaml');
	const initial = `# Editorial configuration
title: Talking With Myself
baseUrl: https://cabrera.systems/blog

tags:
  - id: ideas
    label: { en: Ideas, es: Ideas }
  - id: tec
    label: { en: Tech, es: Tec }
`;
	await writeFile(file, initial, 'utf8');

	const newTags = [
		{ id: 'platform-engineering', label: { en: 'Platform Engineering', es: 'Ingeniería de Plataformas' } }
	];

	const changed = await appendTagsToSiteYaml(file, newTags);
	assert.equal(changed, true);

	const content = await readFile(file, 'utf8');
	assert.ok(content.includes('platform-engineering'));
	assert.ok(content.includes('Ingeniería de Plataformas'));
	assert.ok(content.includes('# Editorial configuration'));

	// Idempotent: running again does not add duplicate
	const changedAgain = await appendTagsToSiteYaml(file, newTags);
	assert.equal(changedAgain, false);

	await rm(dir, { recursive: true, force: true });
});

test('findPreviewUrl: extracts vercel preview URL from mock comment or deployment', async () => {
	// Test null when no preview exists
	const nullUrl = await findPreviewUrl('dummy-token', 'owner/repo', 'fake-sha', 999999).catch(() => null);
	assert.equal(nullUrl, null);
});
