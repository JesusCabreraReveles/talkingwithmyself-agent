// Entrypoint for the Telegram bot service (long polling).
import { Bot } from 'grammy';
import { loadConfig } from '../config.ts';
import { setupBot } from './handlers.ts';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
	console.error('✗ TELEGRAM_BOT_TOKEN no está definido en el archivo .env o en el entorno.');
	process.exit(1);
}

const config = await loadConfig();
const bot = new Bot(token);

setupBot(bot, config);

bot.catch((err) => {
	console.error('[Bot Error]', err);
});

console.log('Iniciando Talking With Myself bot (long polling)…');
bot.start({
	onStart: (info) => {
		console.log(`✓ Bot activo y escuchando: @${info.username} (ID: ${info.id})`);
	}
});
