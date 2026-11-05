import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCleanup } from './cleanup.ts';
import type { Config } from '../config.ts';

test('runCleanup: removes published and failed jobs older than maxDays', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'twm-cleanup-test-'));
	const dataDir = join(dir, 'data');
	const workDir = join(dir, 'work');
	await mkdir(dataDir, { recursive: true });
	await mkdir(workDir, { recursive: true });

	try {
		// Mock config
		const config = {
			paths: { data: dataDir, work: workDir }
		} as unknown as Config;

		// 1. Old published job (200 days old)
		const oldKey = '202501011200';
		const oldDir = join(dataDir, oldKey);
		await mkdir(oldDir, { recursive: true });
		await writeFile(
			join(oldDir, 'job.json'),
			JSON.stringify({
				key: oldKey,
				createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
				status: 'published',
				publish: {
					publishedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
				}
			})
		);

		// 2. Recent published job (2 days old)
		const recentKey = '202611031200';
		const recentDir = join(dataDir, recentKey);
		await mkdir(recentDir, { recursive: true });
		await writeFile(
			join(recentDir, 'job.json'),
			JSON.stringify({
				key: recentKey,
				createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
				status: 'published',
				publish: {
					publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
				}
			})
		);

		// 3. Old active job (collecting) - should NOT be removed
		const activeKey = '202501021200';
		const activeDir = join(dataDir, activeKey);
		await mkdir(activeDir, { recursive: true });
		await writeFile(
			join(activeDir, 'job.json'),
			JSON.stringify({
				key: activeKey,
				createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
				status: 'collecting'
			})
		);

		// Run cleanup with maxDays = 180 (6 months)
		const res = await runCleanup(config, { maxDays: 180 });

		assert.deepEqual(res.jobsRemoved, [oldKey]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
