// Post ids: AAAAMMDDHHmm-<english-slug>, in the configured timezone.
import { POST_ID, POST_ID_SLUG_MAX } from './schema/post.ts';

function parts(date: Date, timeZone: string): Record<string, string> {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** "202611031222" */
export function stamp(date: Date, timeZone: string): string {
	const p = parts(date, timeZone);
	return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

/** "2026-11-03", the post `date`. */
export function isoDate(date: Date, timeZone: string): string {
	const p = parts(date, timeZone);
	return `${p.year}-${p.month}-${p.day}`;
}

/** Lowercase kebab, ASCII only, cut at a word boundary. */
export function kebab(text: string, max: number): string {
	const words = text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	let out = '';
	for (const word of words) {
		const next = out ? `${out}-${word}` : word;
		if (next.length > max) break;
		out = next;
	}
	return out || words[0]?.slice(0, max) || 'post';
}

export function postId(stampValue: string, slug: string): string {
	const id = `${stampValue}-${kebab(slug, POST_ID_SLUG_MAX)}`;
	if (!POST_ID.test(id)) throw new Error(`invalid post id ${id}`);
	return id;
}
