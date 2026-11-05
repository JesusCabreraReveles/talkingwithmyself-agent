// Persists Telegram bot session across restarts (active job, pending questions).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';

export type PendingAction =
	| { type: 'correct_term'; termIndex: number }
	| { type: 'clarify_passage'; passageIndex: number }
	| { type: 'custom_change' };

export type BotSession = {
	activeJobKey: string | null;
	pendingAction?: PendingAction;
	coverVariantIndex?: number;
};

function sessionFile(config: Config): string {
	return join(config.paths.data, 'bot-session.json');
}

export async function loadSession(config: Config): Promise<BotSession> {
	try {
		const raw = await readFile(sessionFile(config), 'utf8');
		return JSON.parse(raw);
	} catch {
		return { activeJobKey: null };
	}
}

export async function saveSession(config: Config, session: BotSession): Promise<void> {
	await mkdir(config.paths.data, { recursive: true });
	await writeFile(sessionFile(config), JSON.stringify(session, null, '\t') + '\n');
}

export async function clearSession(config: Config): Promise<void> {
	try {
		await rm(sessionFile(config), { force: true });
	} catch {}
}
