// Copies the post contract from cabrera-systems-blog so the agent validates with
// the same zod code as the blog build. Fails if SCHEMA_VERSION moved without us.
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';

const SUPPORTED_SCHEMA_VERSION = 1;
const FILES = ['post.ts', 'site.ts', 'validate.ts'];

const config = await loadConfig();
const from = join(config.blog.path, 'src/lib/schema');
const to = new URL('../src/core/schema/', import.meta.url).pathname;

const post = await readFile(join(from, 'post.ts'), 'utf8');
const version = Number(/SCHEMA_VERSION = (\d+)/.exec(post)?.[1]);
if (version !== SUPPORTED_SCHEMA_VERSION) {
	console.error(`blog schemaVersion is ${version}, agent supports ${SUPPORTED_SCHEMA_VERSION}`);
	process.exit(1);
}
for (const file of FILES) await copyFile(join(from, file), join(to, file));
console.log(`synced schema v${version} from ${from}`);
