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

/**
 * Placeholder template (dark grid + title + accent) until stage 2 brings the real
 * templates. `variant` shifts the background so posts don't all look the same.
 */
export async function generateCover(title: string, output: string, config: Config, variant = 0): Promise<void> {
	const { accent, background } = config.cover;
	const bg = background[variant % background.length];
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
	<circle cx="1030" cy="150" r="70" fill="none" stroke="${accent}" stroke-width="3"/>
	<ellipse cx="1030" cy="150" rx="120" ry="26" fill="none" stroke="${accent}" stroke-opacity="0.6" stroke-width="2"/>
	<text x="80" y="120" fill="${accent}" font-family="JetBrains Mono, Menlo, monospace" font-size="26">$ talking-with-myself</text>
	<text x="80" y="${330 - (lines.length - 1) * 38}" fill="#f8fafc" font-family="Space Grotesk, Inter, Helvetica, sans-serif" font-size="64" font-weight="700">${text}</text>
	<rect x="80" y="540" width="120" height="6" fill="${accent}"/>
	<text x="80" y="590" fill="#94a3b8" font-family="JetBrains Mono, Menlo, monospace" font-size="24">cabrera.systems/blog</text>
</svg>`;
	await toCover(Buffer.from(svg), output, config);
}
