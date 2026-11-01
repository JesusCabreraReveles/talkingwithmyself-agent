import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDate, kebab, postId, stamp } from './ids.ts';
import { applyAnswers, imageRole } from './pipeline.ts';
import { imageErrors } from './render.ts';

test('stamp and date use the configured timezone', () => {
	const d = new Date('2026-11-04T05:30:00Z'); // 23:30 on Nov 3 in Mexico City
	assert.equal(stamp(d, 'America/Mexico_City'), '202611032330');
	assert.equal(isoDate(d, 'America/Mexico_City'), '2026-11-03');
});

test('post id slug is kebab, ASCII and ≤ 30 chars at a word boundary', () => {
	assert.equal(kebab('Los dashboards de observabilidad MIENTEN', 30), 'los-dashboards-de');
	assert.equal(kebab('Diseño · Señales', 30), 'diseno-senales');
	assert.equal(postId('202611031222', 'wifi-csi-presence'), '202611031222-wifi-csi-presence');
});

test('image role from caption', () => {
	assert.deepEqual(imageRole('#portada atardecer'), { role: 'cover', caption: 'atardecer' });
	assert.deepEqual(imageRole('cover'), { role: 'cover', caption: '' });
	assert.deepEqual(imageRole('#2 diagrama del pipeline'), { role: 2, caption: 'diagrama del pipeline' });
	assert.deepEqual(imageRole('foto del ESP32'), { role: null, caption: 'foto del ESP32' });
});

test('imageErrors: only ./ webp references to existing files', () => {
	const files = ['cover.webp', 'img-1.webp', 'es.md'];
	assert.deepEqual(imageErrors('es', 'texto ![un diagrama](./img-1.webp) fin', files), []);
	assert.equal(imageErrors('es', '![x](img-1.webp)', files).length, 1);
	assert.equal(imageErrors('es', '![x](./img-2.webp)', files).length, 1);
	assert.equal(imageErrors('es', '![x](./img-1.png)', files).length, 1);
	assert.equal(imageErrors('es', '![](./img-1.webp)', files).length, 1);
	assert.equal(imageErrors('es', '<img src="./img-1.webp">', files).length, 1);
});

test('applyAnswers: unmark answered passages, drop omitted, keep unanswered', () => {
	const text = 'Uno. Hablando por Mateus (el bip) [?] Dos. Algo raro [?] Tres. Sin respuesta [?]';
	const out = applyAnswers(text, [
		{ passage: 'Hablando por Mateus (el bip)', question: '?', answer: 'me refería a Alien' },
		{ passage: 'Algo raro', question: '?', answer: 'omitir' },
		{ passage: 'Sin respuesta', question: '?', answer: '' }
	]);
	assert.equal(out, 'Uno. Hablando por Mateus (el bip) Dos. Tres. Sin respuesta [?]');
});
