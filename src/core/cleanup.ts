import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.ts';
import { jobDir, listJobs } from './job.ts';

export type CleanupResult = {
	jobsRemoved: string[];
	tempFilesRemoved: string[];
};

/**
 * Cleans up published and failed jobs older than maxDays (default 180 days = 6 months)
 * and orphaned temporary files older than 7 days.
 */
export async function runCleanup(
	config: Config,
	options: { maxDays?: number; dryRun?: boolean; log?: (msg: string) => void } = {}
): Promise<CleanupResult> {
	const maxDays = options.maxDays ?? 180;
	const dryRun = options.dryRun ?? false;
	const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
	const log = options.log ?? (() => {});

	const jobs = await listJobs(config);
	const jobsRemoved: string[] = [];

	for (const job of jobs) {
		const jobTime = job.publish?.publishedAt
			? new Date(job.publish.publishedAt).getTime()
			: new Date(job.createdAt).getTime();

		// Clean published jobs older than maxDays (already in git master), or old failed jobs
		if (jobTime < cutoff && (job.status === 'published' || job.status === 'failed')) {
			const dir = jobDir(config, job.key);
			log(`eliminando job antiguo (${job.status}): ${job.key}`);
			if (!dryRun) {
				await rm(dir, { recursive: true, force: true }).catch(() => {});
			}
			jobsRemoved.push(job.key);
		}
	}

	// Also clean orphaned temporary files older than 7 days
	const tmpBase = config.paths.work || tmpdir();
	const tempFilesRemoved: string[] = [];
	try {
		const entries = await readdir(tmpBase, { withFileTypes: true });
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
		for (const e of entries) {
			if (
				e.name.startsWith('twm-') ||
				e.name.startsWith('voice-edit-') ||
				e.name.startsWith('audiogram-')
			) {
				const full = join(tmpBase, e.name);
				try {
					const stats = await stat(full);
					if (stats.mtimeMs < sevenDaysAgo) {
						log(`eliminando archivo temporal huérfano: ${e.name}`);
						if (!dryRun) await rm(full, { recursive: true, force: true }).catch(() => {});
						tempFilesRemoved.push(e.name);
					}
				} catch {}
			}
		}
	} catch {}

	return { jobsRemoved, tempFilesRemoved };
}
