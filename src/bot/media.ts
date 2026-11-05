// Helper to download media from Telegram Bot API to local files.
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export async function downloadTelegramFile(
	botToken: string,
	filePath: string,
	destination: string
): Promise<void> {
	await mkdir(dirname(destination), { recursive: true });
	const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Error descargando archivo de Telegram (${res.status}): ${url}`);
	}
	if (!res.body) throw new Error('Respuesta vacía de Telegram');

	// @ts-expect-error Node.js Readable from web stream
	const nodeReadable = Readable.fromWeb(res.body);
	const out = createWriteStream(destination);
	await pipeline(nodeReadable, out);
}
