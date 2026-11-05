// Keyboards and message helpers for Telegram bot.
import { InlineKeyboard } from 'grammy';
import type { Job, UncertainTerm, UnclearPassage } from '../core/job.ts';

export function termsKeyboard(terms: UncertainTerm[]): InlineKeyboard {
	const kb = new InlineKeyboard();
	terms.forEach((t, i) => {
		if (t.confirmed !== undefined) return;
		kb.text(`✅ "${t.guess}"`, `term:accept:${i}`)
			.text(`✏️ Corregir`, `term:edit:${i}`)
			.row();
	});
	kb.text('Aceptar todas las hipótesis ✅', 'term:accept_all');
	return kb;
}

export function passageKeyboard(index: number): InlineKeyboard {
	return new InlineKeyboard()
		.text('❓ Dejar dudoso', `passage:doubt:${index}`)
		.text('🗑 Omitir pasaje', `passage:omit:${index}`)
		.row()
		.text('✏️ Responder qué quise decir', `passage:answer:${index}`);
}

export function coverChoiceKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text('🎨 Genérala tú', 'cover:generate')
		.text('📎 La mando yo', 'cover:user');
}

export function coverReviewKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text('✅ Usar esta portada', 'cover:confirm')
		.text('🔄 Otra variante', 'cover:cycle')
		.row()
		.text('📎 La mando yo', 'cover:user');
}

export function previewKeyboard(job: Job): InlineKeyboard {
	const audioLabel = job.publishAudio ? '🎙 Publicar audio: SÍ ✅' : '🎙 Publicar audio: NO ❌';
	return new InlineKeyboard()
		.text('✅ Publicar en producción', 'post:publish')
		.text('✏️ Cambios', 'post:edit')
		.row()
		.text(audioLabel, 'post:toggle_audio')
		.row()
		.text('🗑 Descartar', 'post:cancel');
}

export function formatPreviewMessage(job: Job): string {
	const orig = job.draft?.original;
	const adapt = job.draft?.adapted;
	const lines = [
		'✨ <b>Post listo para revisión</b>\n',
		`🇪🇸 <b>ES</b>: ${job.audio?.lang === 'es' ? orig?.title : adapt?.title}`,
		`🇬🇧 <b>EN</b>: ${job.audio?.lang === 'en' ? orig?.title : adapt?.title}\n`,
		`🏷 <b>Tags</b>: ${(orig?.tags ?? []).join(', ')}`
	];

	if (orig?.newTags?.length) {
		lines.push(`✨ <b>Tags nuevos propuestos</b>: ${orig.newTags.map((t) => t.id).join(', ')}`);
	}

	if (job.review?.removed?.length) {
		lines.push(`\n🛡 <b>Eliminado en autorrevisión</b>:\n• ${job.review.removed.join('\n• ')}`);
	}

	if (job.publish?.previewUrl) {
		lines.push(`\n🔗 <b>Preview Vercel</b>:\n<a href="${job.publish.previewUrl}">${job.publish.previewUrl}</a>`);
	}
	if (job.publish?.prUrl) {
		lines.push(`🐙 <b>Pull Request</b>:\n<a href="${job.publish.prUrl}">PR #${job.publish.prNumber}</a>`);
	}

	return lines.join('\n');
}
