// Handlers for Telegram bot: commands, media ingestion, callbacks, and pipeline execution.
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Bot, type Context } from 'grammy';
import type { Config } from '../config.ts';
import { generateCover } from '../core/images.ts';
import {
	findJob,
	jobDir,
	loadJob,
	OMIT,
	saveJob,
	type Job,
	type UncertainTerm,
	type UnclearPassage
} from '../core/job.ts';
import { imageRole, initJob, runJob } from '../core/pipeline.ts';
import { confirmPublishPost, publishPost, unpublishPost } from '../core/publish.ts';
import { downloadTelegramFile } from './media.ts';
import { clearSession, loadSession, saveSession, type BotSession } from './session.ts';
import {
	coverChoiceKeyboard,
	coverReviewKeyboard,
	formatPreviewMessage,
	passageKeyboard,
	previewKeyboard,
	termsKeyboard
} from './ui.ts';

export function setupBot(bot: Bot, config: Config): void {
	const allowedChatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID ?? 0);

	// Whitelist middleware
	bot.use(async (ctx, next) => {
		const senderId = ctx.from?.id;
		if (!senderId) return;

		if (allowedChatId === 0) {
			console.log(`[Telegram] Mensaje recibido con TELEGRAM_ALLOWED_CHAT_ID=0. Sender ID: ${senderId}`);
			await ctx.reply(
				`👋 Hola! Tu Telegram ID es: <code>${senderId}</code>\n\nPor favor configúralo en <code>TELEGRAM_ALLOWED_CHAT_ID</code> en tu archivo <code>.env</code> para autorizar tus mensajes.`,
				{ parse_mode: 'HTML' }
			);
			return;
		}

		if (senderId !== allowedChatId) {
			console.log(`[Telegram] Ignorando mensaje no autorizado de: ${senderId} (@${ctx.from?.username})`);
			return;
		}

		await next();
	});

	// /start
	bot.command('start', async (ctx) => {
		await ctx.reply(
			`👋 <b>Talking With Myself</b>\n\n` +
				`Comandos principales:\n` +
				`• /nuevo — Abre un post nuevo para recopilar notas\n` +
				`• /listo — Cierra la ingesta y arranca el pipeline\n` +
				`• /estado — Consulta el avance del post actual\n` +
				`• /cancelar — Descarta el post en curso\n` +
				`• /reintentar — Reintenta si Claude se pausó\n` +
				`• /unpublish <code>&lt;id&gt;</code> — Despublica un post\n\n` +
				`Escribe /nuevo para empezar.`,
			{ parse_mode: 'HTML' }
		);
	});

	// /nuevo
	bot.command('nuevo', async (ctx) => {
		const session = await loadSession(config);
		if (session.activeJobKey) {
			await ctx.reply(
				`Ya tienes un post abierto (<code>${session.activeJobKey}</code>).\n` +
					`Puedes seguir mandándole contenido, usar /listo para procesarlo o /cancelar para descartarlo.`,
				{ parse_mode: 'HTML' }
			);
			return;
		}

		const job = await initJob(config);
		session.activeJobKey = job.key;
		delete session.pendingAction;
		session.coverVariantIndex = 0;
		await saveSession(config, session);

		await ctx.reply(
			`🎙 <b>Nuevo post abierto</b>: <code>${job.key}</code>\n\n` +
				`Mándame tu nota de voz (audio), fotos con caption (ej. <code>#portada</code>, <code>#1</code>) y URLs o notas de texto.\n` +
				`Cuando termines, escribe /listo.`,
			{ parse_mode: 'HTML' }
		);
	});

	// /cancelar
	bot.command('cancelar', async (ctx) => {
		await clearSession(config);
		await ctx.reply('🗑 Post cancelado y sesión descartada.');
	});

	// /estado
	bot.command('estado', async (ctx) => {
		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay ningún post activo. Usa /nuevo para crear uno.');
			return;
		}

		try {
			const job = await loadJob(config, session.activeJobKey);
			if (job.status === 'collecting') {
				const audios = job.input.audio ? '1 nota de voz' : 'sin audio';
				const imgs = `${job.input.images.length} imagen(es)`;
				const urls = `${job.input.urls.length} enlace(s)`;
				await ctx.reply(
					`📥 <b>Recopilando contenido</b> (<code>${job.key}</code>):\n• ${audios}\n• ${imgs}\n• ${urls}\n\nEscribe /listo para procesar.`,
					{ parse_mode: 'HTML' }
				);
			} else if (job.status === 'questions_pending') {
				await ctx.reply('⏳ Esperando respuestas a términos o pasajes dudosos.', {
					reply_markup: job.terms?.length ? termsKeyboard(job.terms) : undefined
				});
			} else if (job.status === 'previewed') {
				await ctx.reply(formatPreviewMessage(job), {
					parse_mode: 'HTML',
					reply_markup: previewKeyboard(job)
				});
			} else {
				await ctx.reply(`Estado: <b>${job.status}</b>${job.error ? `\nError: ${job.error}` : ''}`, {
					parse_mode: 'HTML'
				});
			}
		} catch (e) {
			await ctx.reply(`Error leyendo estado: ${(e as Error).message}`);
		}
	});

	// /unpublish
	bot.command('unpublish', async (ctx) => {
		const id = ctx.match?.trim();
		if (!id) {
			await ctx.reply('Uso: /unpublish <code>&lt;id-del-post&gt;</code>', { parse_mode: 'HTML' });
			return;
		}
		const statusMsg = await ctx.reply(`⏳ Abriendo PR para despublicar <code>${id}</code>…`, {
			parse_mode: 'HTML'
		});
		try {
			const res = await unpublishPost(config, id, {
				log: (msg) => {
					ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, `· ${msg}`).catch(() => {});
				}
			});
			await ctx.reply(`Pull request creado: <a href="${res.pr.html_url}">${res.pr.html_url}</a>`, {
				parse_mode: 'HTML'
			});
		} catch (e) {
			await ctx.reply(`✗ Error al despublicar: ${(e as Error).message}`);
		}
	});

	// Helper to execute pipeline from Telegram
	async function runPipelineForJob(ctx: Context, job: Job, session: BotSession) {
		const statusMsg = await ctx.reply('🚀 <b>Iniciando procesamiento…</b>', { parse_mode: 'HTML' });
		let lastEditTime = 0;
		const log = (msg: string) => {
			console.log(`[Bot Log] ${msg}`);
			const now = Date.now();
			if (now - lastEditTime > 2000) {
				lastEditTime = now;
				ctx.api
					.editMessageText(statusMsg.chat.id, statusMsg.message_id, `⚙️ <b>Avance</b>: ${msg}`, {
						parse_mode: 'HTML'
					})
					.catch(() => {});
			}
		};

		const confirmTerms = async (terms: UncertainTerm[]) => {
			const pending = terms.filter((t) => t.confirmed === undefined);
			if (pending.length === 0) return { answers: terms.map((t) => t.confirmed ?? t.guess), fromJesus: true };
			await ctx.reply('❓ <b>Términos técnicos dudosos detectados:</b>\n¿Cuál es la hipótesis correcta?', {
				parse_mode: 'HTML',
				reply_markup: termsKeyboard(pending)
			});
			return null;
		};

		const clarify = async (passages: UnclearPassage[]) => {
			const pending = passages.filter((p) => p.answer === undefined);
			if (pending.length === 0) return passages.map((p) => p.answer ?? '');
			const first = pending[0];
			const idx = passages.indexOf(first);
			await ctx.reply(`❓ <b>Pasaje no comprendido del audio:</b>\n«${first.passage}»\n\n${first.question}`, {
				parse_mode: 'HTML',
				reply_markup: passageKeyboard(idx)
			});
			return null;
		};

		try {
			job = await runJob(config, job, { log, confirmTerms, clarify });

			if (job.status === 'questions_pending') {
				await ctx.api.editMessageText(
					statusMsg.chat.id,
					statusMsg.message_id,
					'⏸ <b>Pausa</b>: Se requieren aclaraciones arriba antes de continuar.',
					{ parse_mode: 'HTML' }
				);
				return;
			}

			if (job.status === 'ready') {
				await ctx.api.editMessageText(
					statusMsg.chat.id,
					statusMsg.message_id,
					'✨ <b>Borrador completado</b>. Creando preview en Vercel…',
					{ parse_mode: 'HTML' }
				);
				await publishPost(config, job, { log });
				await ctx.reply(formatPreviewMessage(job), {
					parse_mode: 'HTML',
					reply_markup: previewKeyboard(job)
				});
			}
		} catch (e) {
			console.error('[Bot Pipeline Error]', e);
			await ctx.api
				.editMessageText(
					statusMsg.chat.id,
					statusMsg.message_id,
					`✗ <b>Error en pipeline</b>:\n${(e as Error).message}`,
					{ parse_mode: 'HTML' }
				)
				.catch(() => {});
		}
	}

	// /listo
	bot.command('listo', async (ctx) => {
		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay ningún post activo. Usa /nuevo para empezar.');
			return;
		}

		const job = await loadJob(config, session.activeJobKey);
		if (!job.input.audio) {
			await ctx.reply('⚠️ No has mandado ninguna nota de voz todavía. Mándala antes de escribir /listo.');
			return;
		}

		await runPipelineForJob(ctx, job, session);
	});

	// /reintentar
	bot.command('reintentar', async (ctx) => {
		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay ningún post activo para reintentar.');
			return;
		}
		const job = await loadJob(config, session.activeJobKey);
		await runPipelineForJob(ctx, job, session);
	});

	// Voice notes & audio files
	bot.on(['message:voice', 'message:audio'], async (ctx) => {
		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay ningún post abierto. ¿Quieres iniciar uno? Usa /nuevo.');
			return;
		}

		const job = await loadJob(config, session.activeJobKey);
		const fileObj = ctx.message.voice ?? ctx.message.audio;
		if (!fileObj) return;

		const fileInfo = await ctx.api.getFile(fileObj.file_id);
		if (!fileInfo.file_path) throw new Error('No se pudo obtener ruta del archivo en Telegram');

		const ext = fileInfo.file_path.endsWith('.mp3') ? '.mp3' : '.oga';
		const localDest = join(jobDir(config, job.key), 'input', `audio${ext}`);

		await downloadTelegramFile(bot.token, fileInfo.file_path, localDest);
		job.input.audio = `input/audio${ext}`;
		await saveJob(config, job);

		await ctx.reply(`🎙 <b>Nota de voz recibida</b> (${fileObj.duration}s). Puedes mandar imágenes, notas o escribir /listo.`, {
			parse_mode: 'HTML'
		});
	});

	// Photos & document images
	bot.on(['message:photo', 'message:document'], async (ctx) => {
		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay ningún post abierto. Usa /nuevo para comenzar uno.');
			return;
		}

		const job = await loadJob(config, session.activeJobKey);
		let fileId: string | null = null;
		let ext = '.jpg';

		if (ctx.message.photo) {
			// Best quality is the last element
			const photo = ctx.message.photo.at(-1)!;
			fileId = photo.file_id;
		} else if (ctx.message.document) {
			const mime = ctx.message.document.mime_type ?? '';
			if (!mime.startsWith('image/')) return;
			fileId = ctx.message.document.file_id;
			if (ctx.message.document.file_name?.endsWith('.png')) ext = '.png';
			if (ctx.message.document.file_name?.endsWith('.webp')) ext = '.webp';
		}

		if (!fileId) return;

		const fileInfo = await ctx.api.getFile(fileId);
		if (!fileInfo.file_path) return;

		const caption = ctx.message.caption ?? '';
		const roleInfo = imageRole(caption);
		const filename = `input/image-${job.input.images.length + 1}${ext}`;
		const dest = join(jobDir(config, job.key), filename);

		await downloadTelegramFile(bot.token, fileInfo.file_path, dest);
		job.input.images.push({ file: filename, ...roleInfo });
		await saveJob(config, job);

		const roleDesc =
			roleInfo.role === 'cover'
				? 'portada (#portada)'
				: typeof roleInfo.role === 'number'
					? `posición #${roleInfo.role}`
					: 'ubicación automática';

		await ctx.reply(`📷 <b>Imagen recibida</b>: ${roleDesc}.`, { parse_mode: 'HTML' });
	});

	// Text messages
	bot.on('message:text', async (ctx) => {
		const text = ctx.message.text.trim();
		if (text.startsWith('/')) return; // Ignore commands handled above

		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay un post abierto. Usa /nuevo para crear uno nuevo.');
			return;
		}

		const job = await loadJob(config, session.activeJobKey);

		// Check if replying to pending question
		if (session.pendingAction) {
			const act = session.pendingAction;
			delete session.pendingAction;
			await saveSession(config, session);

			if (act.type === 'correct_term') {
				job.terms![act.termIndex].confirmed = text;
				await saveJob(config, job);
				await ctx.reply(`✅ Término corregido a: <b>${text}</b>`, { parse_mode: 'HTML' });
				await runPipelineForJob(ctx, job, session);
				return;
			}
			if (act.type === 'clarify_passage') {
				job.unclear![act.passageIndex].answer = text;
				await saveJob(config, job);
				await ctx.reply(`✅ Aclaración guardada.`, { parse_mode: 'HTML' });
				await runPipelineForJob(ctx, job, session);
				return;
			}
		}

		// Detect URLs
		const urls = text.split(/\s+/).filter((w) => /^https?:\/\//i.test(w));
		if (urls.length > 0) {
			job.input.urls.push(...urls);
			await saveJob(config, job);
			await ctx.reply(`🔗 <b>${urls.length} enlace(s) guardado(s)</b> como fuente.`, {
				parse_mode: 'HTML'
			});
			return;
		}

		// Otherwise context note
		job.input.notes = job.input.notes ? `${job.input.notes}\n${text}` : text;
		await saveJob(config, job);
		await ctx.reply('📝 <b>Nota añadida</b> al contexto del post.', { parse_mode: 'HTML' });
	});

	// Callback queries (Buttons)
	bot.on('callback_query:data', async (ctx) => {
		const data = ctx.callbackQuery.data;
		await ctx.answerCallbackQuery();

		const session = await loadSession(config);
		if (!session.activeJobKey) {
			await ctx.reply('No hay un post activo.');
			return;
		}
		const job = await loadJob(config, session.activeJobKey);

		// Term acceptance
		if (data.startsWith('term:accept:')) {
			const idx = Number(data.split(':')[2]);
			if (job.terms?.[idx]) {
				job.terms[idx].confirmed = job.terms[idx].guess;
				await saveJob(config, job);
				await ctx.reply(`✅ Término aceptado: <b>${job.terms[idx].guess}</b>`, { parse_mode: 'HTML' });
				await runPipelineForJob(ctx, job, session);
			}
			return;
		}
		if (data === 'term:accept_all') {
			for (const t of job.terms ?? []) {
				if (t.confirmed === undefined) t.confirmed = t.guess;
			}
			await saveJob(config, job);
			await ctx.reply('✅ Todas las hipótesis de términos aceptadas.');
			await runPipelineForJob(ctx, job, session);
			return;
		}
		if (data.startsWith('term:edit:')) {
			const idx = Number(data.split(':')[2]);
			session.pendingAction = { type: 'correct_term', termIndex: idx };
			await saveSession(config, session);
			await ctx.reply(
				`✏️ Escribe en el chat la ortografía correcta para: <i>${job.terms?.[idx]?.heard}</i>`,
				{ parse_mode: 'HTML' }
			);
			return;
		}

		// Passage clarification
		if (data.startsWith('passage:doubt:')) {
			const idx = Number(data.split(':')[2]);
			job.unclear![idx].answer = ''; // doubtful
			await saveJob(config, job);
			await ctx.reply('❓ Pasaje conservado como dudoso.');
			await runPipelineForJob(ctx, job, session);
			return;
		}
		if (data.startsWith('passage:omit:')) {
			const idx = Number(data.split(':')[2]);
			job.unclear![idx].answer = OMIT;
			await saveJob(config, job);
			await ctx.reply('🗑 Pasaje omitido.');
			await runPipelineForJob(ctx, job, session);
			return;
		}
		if (data.startsWith('passage:answer:')) {
			const idx = Number(data.split(':')[2]);
			session.pendingAction = { type: 'clarify_passage', passageIndex: idx };
			await saveSession(config, session);
			await ctx.reply('✏️ Escribe en el chat qué quisiste decir en ese fragmento:');
			return;
		}

		// Post actions
		if (data === 'post:toggle_audio') {
			job.publishAudio = !job.publishAudio;
			await saveJob(config, job);
			await ctx.editMessageReplyMarkup({ reply_markup: previewKeyboard(job) });
			return;
		}

		if (data === 'post:cancel') {
			await clearSession(config);
			await ctx.reply('🗑 Post descartado.');
			return;
		}

		if (data === 'post:publish') {
			const statusMsg = await ctx.reply('🚀 <b>Publicando a producción en master…</b>', {
				parse_mode: 'HTML'
			});
			try {
				const res = await confirmPublishPost(config, job, {
					log: (msg) => {
						ctx.api
							.editMessageText(statusMsg.chat.id, statusMsg.message_id, `· ${msg}`)
							.catch(() => {});
					}
				});
				await clearSession(config);
				await ctx.reply(
					`🎉 <b>¡Post publicado exitosamente!</b>\n\n` +
						`🇪🇸 <b>ES</b>: <a href="${res.urls.es}">${res.urls.es}</a>\n` +
						`🇬🇧 <b>EN</b>: <a href="${res.urls.en}">${res.urls.en}</a>`,
					{ parse_mode: 'HTML' }
				);
			} catch (e) {
				await ctx.reply(`✗ Error al publicar: ${(e as Error).message}`);
			}
			return;
		}
	});
}
