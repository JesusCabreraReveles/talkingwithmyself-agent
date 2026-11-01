// Images → WebP. The cover is cropped to 1200×630 (Open Graph); body images keep their ratio.
import sharp from 'sharp';
import type { Config } from '../config.ts';

export async function toCover(input: string | Buffer, output: string, config: Config): Promise<void> {
	await sharp(input).rotate().resize(1200, 630, { fit: 'cover', position: 'attention' })
		.webp({ quality: config.images.quality }).toFile(output);
}

export async function toBodyImage(input: string, output: string, config: Config): Promise<void> {
	await sharp(input).rotate().resize({ width: config.images.maxWidth, withoutEnlargement: true })
		.webp({ quality: config.images.quality }).toFile(output);
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/)) {
		if (line && (line + ' ' + word).length > maxChars) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	if (lines.length > maxLines) {
		lines.length = maxLines;
		lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
	}
	return lines;
}

/** Small deterministic hash so a title always gets the same waveform. */
function hash(text: string): number {
	let h = 2166136261;
	for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
	return h >>> 0;
}

type Motif = (accent: string, title: string) => string;

const MOTIFS: Record<string, Motif> = {
	orbit: (accent) => `
	<circle cx="1030" cy="150" r="70" fill="none" stroke="${accent}" stroke-width="3"/>
	<ellipse cx="1030" cy="150" rx="120" ry="26" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/>
	<circle cx="912" cy="158" r="5" fill="${accent}"/>`,

	// A voice-note waveform; bar heights come from the title.
	wave: (accent, title) => {
		let seed = hash(title);
		const bars: string[] = [];
		for (let i = 0; i < 34; i++) {
			seed = Math.imul(seed ^ (seed >>> 13), 1274126177) >>> 0;
			const envelope = Math.sin((i / 33) * Math.PI);
			const h = 10 + Math.round(((seed % 1000) / 1000) * 110 * envelope + 20 * envelope);
			const opacity = (0.35 + 0.65 * envelope).toFixed(2);
			bars.push(`<rect x="${800 + i * 10}" y="${150 - h / 2}" width="5" height="${h}" rx="2.5" fill="${accent}" fill-opacity="${opacity}"/>`);
		}
		return bars.join('');
	},

	// A terminal window; the title sits where the command output would.
	terminal: (accent) => `
	<rect x="840" y="70" width="290" height="170" rx="12" fill="#000000" fill-opacity="0.35" stroke="#ffffff" stroke-opacity="0.15"/>
	<circle cx="866" cy="94" r="6" fill="#ef4444" fill-opacity="0.8"/>
	<circle cx="886" cy="94" r="6" fill="#eab308" fill-opacity="0.8"/>
	<circle cx="906" cy="94" r="6" fill="#22c55e" fill-opacity="0.8"/>
	<text x="862" y="150" fill="#94a3b8" font-family="JetBrains Mono, Menlo, monospace" font-size="22">$ think --aloud</text>
	<text x="862" y="190" fill="${accent}" font-family="JetBrains Mono, Menlo, monospace" font-size="22">&gt; recording…</text>
	<rect x="1052" y="172" width="12" height="24" fill="${accent}"/>`
};
export const COVER_VARIANTS = Object.keys(MOTIFS).length;

/**
 * Generated cover: shared frame (brand, title, footer) + a motif. `variant` picks the
 * motif first, then the background, so 🔄 "otra variante" always looks different.
 */
export async function generateCover(title: string, output: string, config: Config, variant = 0): Promise<void> {
	const { accent, background } = config.cover;
	const names = Object.keys(MOTIFS);
	const motif = MOTIFS[names[variant % names.length]];
	const bg = background[Math.floor(variant / names.length) % background.length];
	const lines = wrap(title, 26, 3);
	const text = lines
		.map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 76}">${escapeXml(l)}</tspan>`)
		.join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
	<defs>
		<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
			<path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
		</pattern>
		<radialGradient id="glow" cx="85%" cy="15%" r="60%">
			<stop offset="0" stop-color="${accent}" stop-opacity="0.35"/>
			<stop offset="1" stop-color="${accent}" stop-opacity="0"/>
		</radialGradient>
	</defs>
	<rect width="1200" height="630" fill="${bg}"/>
	<rect width="1200" height="630" fill="url(#grid)"/>
	<rect width="1200" height="630" fill="url(#glow)"/>
	${motif(accent, title)}
	<text x="80" y="120" fill="${accent}" font-family="JetBrains Mono, Menlo, monospace" font-size="26">$ talking-with-myself</text>
	<text x="80" y="${330 - (lines.length - 1) * 38}" fill="#f8fafc" font-family="Space Grotesk, Inter, Helvetica, sans-serif" font-size="64" font-weight="700">${text}</text>
	<rect x="80" y="540" width="120" height="6" fill="${accent}"/>
	<text x="80" y="590" fill="#94a3b8" font-family="JetBrains Mono, Menlo, monospace" font-size="24">cabrera.systems/blog</text>
</svg>`;
	await toCover(Buffer.from(svg), output, config);
}
