import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, buildScript, firstQueueDate, scriptPath, TikTokDraft, weekdayEs } from './tiktok.ts';

const TZ = 'America/Mexico_City';

const draft = {
	topic: 'ia',
	caption: 'Agentes de IA con roles de Scrum y tú como Product Owner. Post completo en cabrera.systems/blog',
	hashtags: ['#IA', '#scrum', '#programacion'],
	slides: [
		{ screen: '¿Y si la IA fuera tu equipo?', say: 'Escribir especificaciones y revisar todo lo que hace la IA ya me está tomando demasiado tiempo.', photo: 'developer laptop night' },
		{ screen: '1. Agentes con roles de Scrum', say: 'Mi idea es un equipo de agentes con roles definidos que conversan entre ellos.', photo: 'team meeting whiteboard' },
		{ screen: '2. Ellos arman el backlog', say: 'Generan el backlog y estiman cuántos tokens cuesta cada tarea.', photo: 'sticky notes board' },
		{ screen: '3. Tú eres el Product Owner', say: 'Nosotros dejamos de revisar línea por línea y decidimos qué se construye y por qué.', photo: 'manager planning office' },
		{ screen: 'Léelo completo en el blog', say: 'Así cambiaría mi forma de trabajar. Lo cuento completo en mi blog. Sígueme para más.', photo: 'notebook writing plan' }
	]
};

test('firstQueueDate: before the Pi runs it is today, afterwards tomorrow', () => {
	// 8:30 and 18:44 in Mexico City (UTC-6)
	assert.equal(firstQueueDate(new Date('2026-11-07T14:30:00Z'), TZ, 9), '2026-11-07');
	assert.equal(firstQueueDate(new Date('2026-11-08T00:44:00Z'), TZ, 9), '2026-11-08');
	// end of month / year
	assert.equal(firstQueueDate(new Date('2027-01-01T05:00:00Z'), TZ, 9), '2027-01-01');
	assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('scriptPath: matches what publish_daily.py and make_video.py read', () => {
	const path = scriptPath('2026-11-08');
	assert.equal(path, 'guiones/2026-11-08-voz.json');
	// make_video.py: r"(\d{4}-\d{2}-\d{2})(?:-([a-z]+))?\.json$" -> weekday style
	assert.match(path.split('/')[1], /^(\d{4}-\d{2}-\d{2})(?:-([a-z]+))?\.json$/);
});

test('buildScript: same format as the daily scripts, tag with the publish weekday', () => {
	const parsed = TikTokDraft.parse(draft);
	const script = buildScript(parsed, '2026-11-08');
	assert.equal(weekdayEs('2026-11-08'), 'DOMINGO');
	assert.equal(script.lang, 'es');
	assert.equal(script.tag, 'IA · DOMINGO');
	assert.equal(script.brand, 'geminislabs.com');
	assert.deepEqual(script.hashtags, ['#ia', '#scrum', '#programacion', '#techtok']);
	assert.deepEqual(Object.keys(script), ['lang', 'tag', 'brand', 'caption', 'hashtags', 'slides']);
	assert.equal(script.slides.length, 5);
});

test('TikTokDraft: rejects scripts that break the video rules', () => {
	const long = structuredClone(draft);
	long.slides[0].screen = 'uno dos tres cuatro cinco seis siete ocho';
	assert.equal(TikTokDraft.safeParse(long).success, false);

	const noOutro = structuredClone(draft);
	noOutro.slides[4].say = 'Lo cuento completo en mi blog.';
	assert.equal(TikTokDraft.safeParse(noOutro).success, false);

	const few = structuredClone(draft);
	few.slides = few.slides.slice(0, 3);
	assert.equal(TikTokDraft.safeParse(few).success, false);
});
