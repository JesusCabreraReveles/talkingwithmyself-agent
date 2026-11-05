// Stage 3: Publishing to cabrera-systems-blog via Git branch, PR, Vercel preview,
// and squash-merging to master upon confirmation.
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import type { Config } from '../config.ts';
import { exec } from './exec.ts';
import {
	createPullRequest,
	deleteBranch,
	findOpenPullRequest,
	pollChecks,
	pollPreview,
	squashMerge,
	type GitHubPullRequest
} from './github.ts';
import { isoDate } from './ids.ts';
import { jobDir, saveJob, type Job } from './job.ts';
import { renderMarkdown } from './render.ts';
import { PostFrontmatter, SCHEMA_VERSION, type Lang } from './schema/post.ts';
import { SiteConfig } from './schema/site.ts';
import { splitFrontmatter, validatePostFolder } from './schema/validate.ts';
import {
	generateAudiogram,
	generateDevToMarkdown,
	generateShareTexts,
	writeShareFiles,
	type ShareTexts
} from './share.ts';

export type PublishHooks = {
	log: (msg: string) => void;
};

export type ConfirmPublishResult = {
	urls: { en: string; es: string };
	shareTexts: ShareTexts;
	audiogramPath?: string | null;
};

export async function loadSiteConfig(blogPath: string): Promise<SiteConfig> {
	const siteRaw = await readFile(join(blogPath, 'src/content/site.yaml'), 'utf8');
	return SiteConfig.parse(parseDocument(siteRaw).toJS());
}

export function getJobCanonicalUrls(site: SiteConfig, job: Job): { en: string; es: string } {
	const originalLang = job.audio?.lang ?? 'es';
	const enSlug = originalLang === 'en' ? job.draft?.original.slug : job.draft?.adapted.slug;
	const esSlug = originalLang === 'es' ? job.draft?.original.slug : job.draft?.adapted.slug;
	return {
		en: `${site.baseUrl}/en/${enSlug}`,
		es: `${site.baseUrl}/es/${esSlug}`
	};
}

function getGithubToken(): string {
	const token = process.env.GITHUB_TOKEN?.trim();
	if (!token) throw new Error('GITHUB_TOKEN no configurado en entorno ni en .env');
	return token;
}

function getAuthHeader(token: string): string {
	return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
}

async function getGitAuthor(
	config: Config,
	blogPath: string
): Promise<{ name: string; email: string }> {
	const name =
		process.env.GIT_AUTHOR_NAME ||
		config.git.authorName ||
		(await exec('git', ['-C', blogPath, 'config', 'user.name']).catch(() => '')) ||
		'Jesus Cabrera';
	const email =
		process.env.GIT_AUTHOR_EMAIL ||
		config.git.authorEmail ||
		(await exec('git', ['-C', blogPath, 'config', 'user.email']).catch(() => '')) ||
		'jesus.cabrera.code@proton.me';
	return { name: name.trim(), email: email.trim() };
}

/** Appends new tags to site.yaml preserving comments and formatting. */
export async function appendTagsToSiteYaml(
	siteYamlPath: string,
	newTags: { id: string; label: { en: string; es: string } }[]
): Promise<boolean> {
	if (newTags.length === 0) return false;
	const content = await readFile(siteYamlPath, 'utf8');
	const doc = parseDocument(content);
	const existingTags: { id: string }[] = doc.toJS()?.tags ?? [];
	let added = false;
	for (const tag of newTags) {
		if (existingTags.some((t) => t.id === tag.id)) continue;
		doc.addIn(['tags'], tag);
		added = true;
	}
	if (added) {
		await writeFile(siteYamlPath, doc.toString());
	}
	return added;
}

/** Verifies that the blog repo working tree is clean. */
export async function assertCleanRepo(blogPath: string): Promise<void> {
	const status = await exec('git', ['-C', blogPath, 'status', '--porcelain']);
	if (status.trim()) {
		throw new Error(
			`El repositorio del blog (${blogPath}) tiene cambios sin comitear:\n${status.trim()}\nPor favor comitea o descarta los cambios antes de publicar.`
		);
	}
}

/** Validates the post before creating any branch or commit. */
export async function validatePostForPublish(
	config: Config,
	job: Job
): Promise<{ site: SiteConfig; postDir: string; files: string[] }> {
	if (!job.postId) throw new Error(`El job ${job.key} no tiene postId`);
	const postDir = join(jobDir(config, job.key), 'post', job.postId);
	const files = await readdir(postDir).catch(() => {
		throw new Error(`Carpeta del post no encontrada: ${postDir}`);
	});

	const siteRaw = await readFile(join(config.blog.path, 'src/content/site.yaml'), 'utf8');
	const site = SiteConfig.parse(parseDocument(siteRaw).toJS());

	const markdown: Partial<Record<Lang, string>> = {};
	if (files.includes('en.md')) markdown.en = await readFile(join(postDir, 'en.md'), 'utf8');
	if (files.includes('es.md')) markdown.es = await readFile(join(postDir, 'es.md'), 'utf8');

	const siteWithNewTags = {
		...site,
		tags: [...site.tags, ...(job.draft?.original.newTags ?? [])]
	};

	const { errors } = validatePostFolder({ id: job.postId, files, markdown }, siteWithNewTags);
	if (errors.length > 0) {
		throw new Error(`El post no pasa la validación del schema:\n${errors.join('\n')}`);
	}

	return { site, postDir, files };
}

export type PublishResult = {
	pr: GitHubPullRequest;
	previewUrl: string;
	branch: string;
	published?: boolean;
	urls?: { en: string; es: string };
};

/**
 * Stage 3 Main: creates post branch, commits files, pushes, opens PR, and waits for Vercel preview.
 * If confirm is true, proceeds directly to squash merge.
 */
export async function publishPost(
	config: Config,
	job: Job,
	hooks: PublishHooks,
	options: { confirm?: boolean; timeoutMs?: number } = {}
): Promise<PublishResult> {
	const token = getGithubToken();
	const blogPath = config.blog.path;
	const { postDir, files } = await validatePostForPublish(config, job);
	const postId = job.postId!;
	const branchName = `post/${postId}`;
	const originalLang = job.audio?.lang ?? 'es';
	const otherLang = originalLang === 'es' ? 'en' : 'es';

	hooks.log(`verificando estado de ${blogPath}…`);
	await assertCleanRepo(blogPath);

	const author = await getGitAuthor(config, blogPath);
	const authHeader = getAuthHeader(token);

	// 1. Fetch origin master and checkout post/<id> branch
	hooks.log(`preparando rama ${branchName} desde master…`);
	await exec('git', ['-C', blogPath, 'fetch', 'origin', config.blog.branch]);
	await exec('git', ['-C', blogPath, 'checkout', '-B', branchName, `origin/${config.blog.branch}`]);

	// 2. Copy post files into blog repo
	const targetDir = join(blogPath, 'src/content/posts', postId);
	await rm(targetDir, { recursive: true, force: true });
	await mkdir(targetDir, { recursive: true });

	for (const file of files) {
		await copyFile(join(postDir, file), join(targetDir, file));
	}

	// 3. Add new tags if present
	if (job.draft?.original.newTags?.length) {
		hooks.log(`agregando ${job.draft.original.newTags.length} tag(s) nuevo(s) a site.yaml…`);
		await appendTagsToSiteYaml(join(blogPath, 'src/content/site.yaml'), job.draft.original.newTags);
	}

	// 4. Commit changes
	await exec('git', ['-C', blogPath, 'add', `src/content/posts/${postId}`, 'src/content/site.yaml']);
	const hasChanges = await exec('git', ['-C', blogPath, 'diff', '--cached', '--quiet']).then(
		() => false,
		() => true
	);

	if (hasChanges) {
		const commitMsg = `post: ${postId} (${originalLang} → ${otherLang})\n\nCo-Authored-By: ${config.git.coAuthor}`;
		await exec('git', ['-C', blogPath, 'commit', '-m', commitMsg], {
			env: {
				GIT_AUTHOR_NAME: author.name,
				GIT_AUTHOR_EMAIL: author.email,
				GIT_COMMITTER_NAME: author.name,
				GIT_COMMITTER_EMAIL: author.email
			}
		});
		hooks.log(`commit creado como ${author.name} <${author.email}> con coautor ${config.git.coAuthor}`);
	}

	// 5. Push to GitHub
	hooks.log(`haciendo push a origin ${branchName}…`);
	await exec('git', [
		'-C',
		blogPath,
		'-c',
		`http.https://github.com/.extraheader=${authHeader}`,
		'push',
		'-u',
		'origin',
		branchName,
		'--force-with-lease'
	]);

	const commitSha = (await exec('git', ['-C', blogPath, 'rev-parse', 'HEAD'])).trim();

	// 6. Open or reuse PR
	let pr = await findOpenPullRequest(token, config.blog.repo, branchName);
	if (!pr) {
		hooks.log(`abriendo pull request ${branchName} → ${config.blog.branch}…`);
		const title = `post: ${postId} (${originalLang} → ${otherLang})`;
		const newTagsDesc = job.draft?.original.newTags?.length
			? `\n- **Tags nuevos**: ${job.draft.original.newTags.map((t) => `\`${t.id}\``).join(', ')}`
			: '';
		const body = `## Post: ${job.draft?.original.title ?? postId}

- **ID**: \`${postId}\`
- **Idioma original**: \`${originalLang}\`
- **Tags**: ${(job.draft?.original.tags ?? []).map((t) => `\`${t}\``).join(', ')}${newTagsDesc}

### Verificaciones automáticas
- [ ] Vercel preview deployment
- [ ] CI check (\`test\`, \`check\`, \`build\`)

> Generado automáticamente por \`talkingwithmyself-agent\`.`;

		pr = await createPullRequest(token, config.blog.repo, {
			title,
			head: branchName,
			base: config.blog.branch,
			body
		});
	}
	hooks.log(`PR disponible: ${pr.html_url}`);

	// 7. Poll for Vercel preview
	hooks.log('esperando preview de Vercel…');
	const { previewUrl } = await pollPreview(token, config.blog.repo, commitSha, pr.number, hooks.log, {
		timeoutMs: options.timeoutMs
	});

	job.status = 'previewed';
	job.publish = {
		branch: branchName,
		prNumber: pr.number,
		prUrl: pr.html_url,
		commitSha,
		previewUrl
	};
	await saveJob(config, job);

	// 8. If confirmation requested, proceed to merge
	if (options.confirm) {
		const final = await confirmPublishPost(config, job, hooks, { timeoutMs: options.timeoutMs });
		return { pr, previewUrl, branch: branchName, published: true, urls: final.urls };
	}

	return { pr, previewUrl, branch: branchName, published: false };
}

/**
 * Stage 3 Final: sets the definitive merge date, commits, pushes, awaits checks,
 * squash-merges PR, and deletes remote branch.
 */
export async function confirmPublishPost(
	config: Config,
	job: Job,
	hooks: PublishHooks,
	options: { timeoutMs?: number } = {}
): Promise<ConfirmPublishResult> {
	const token = getGithubToken();
	const blogPath = config.blog.path;
	const postId = job.postId!;
	const branchName = job.publish?.branch ?? `post/${postId}`;
	const prNumber = job.publish?.prNumber;
	if (!prNumber) throw new Error(`El job ${job.key} no tiene PR registrado para confirmar publicación`);

	const siteRaw = await readFile(join(blogPath, 'src/content/site.yaml'), 'utf8');
	const site = SiteConfig.parse(parseDocument(siteRaw).toJS());
	const author = await getGitAuthor(config, blogPath);
	const authHeader = getAuthHeader(token);
	const originalLang = job.audio?.lang ?? 'es';
	const otherLang = originalLang === 'es' ? 'en' : 'es';

	const today = isoDate(new Date(), config.timezone);
	hooks.log(`fijando fecha definitiva de publicación: ${today} (${config.timezone})…`);

	// Ensure we are on branchName
	await exec('git', ['-C', blogPath, 'checkout', branchName]);

	// Update date in en.md and es.md in blog repo and in job directory
	for (const lang of ['en', 'es'] as const) {
		const blogFile = join(blogPath, 'src/content/posts', postId, `${lang}.md`);
		const raw = await readFile(blogFile, 'utf8');
		const { data, body } = splitFrontmatter(raw);
		const fm = PostFrontmatter.parse({ ...(data as Record<string, unknown>), date: today });
		const updated = renderMarkdown(fm, body);
		await writeFile(blogFile, updated);

		const jobFile = join(jobDir(config, job.key), 'post', postId, `${lang}.md`);
		await writeFile(jobFile, updated).catch(() => {});
	}

	const urls = getJobCanonicalUrls(site, job);

	// Generate share outputs for social networks and dev.to
	hooks.log('generando textos de difusión para LinkedIn y X…');
	const shareTexts = await generateShareTexts(config, job, urls);

	const esPost = originalLang === 'es' ? job.draft!.original : job.draft!.adapted;
	const enPost = originalLang === 'en' ? job.draft!.original : job.draft!.adapted;
	const devTo = {
		es: generateDevToMarkdown(esPost, 'es', urls.es, config.blog.repo, postId),
		en: generateDevToMarkdown(enPost, 'en', urls.en, config.blog.repo, postId)
	};

	await writeShareFiles(join(blogPath, 'src/content/posts', postId), shareTexts, devTo);
	await writeShareFiles(join(jobDir(config, job.key), 'post', postId), shareTexts, devTo).catch(() => {});

	// Render audiogram if audio was published
	let audiogramPath: string | null = null;
	if (job.publishAudio && job.audio) {
		const outAudio = join(config.paths.work, `audiogram-${postId}.mp4`);
		audiogramPath = await generateAudiogram(config, job, outAudio, hooks);
	}

	await exec('git', ['-C', blogPath, 'add', `src/content/posts/${postId}`]);
	const hasChanges = await exec('git', ['-C', blogPath, 'diff', '--cached', '--quiet']).then(
		() => false,
		() => true
	);

	if (hasChanges) {
		const commitMsg = `publish: ${postId} (date: ${today})\n\nCo-Authored-By: ${config.git.coAuthor}`;
		await exec('git', ['-C', blogPath, 'commit', '-m', commitMsg], {
			env: {
				GIT_AUTHOR_NAME: author.name,
				GIT_AUTHOR_EMAIL: author.email,
				GIT_COMMITTER_NAME: author.name,
				GIT_COMMITTER_EMAIL: author.email
			}
		});

		hooks.log(`haciendo push del commit final a ${branchName}…`);
		await exec('git', [
			'-C',
			blogPath,
			'-c',
			`http.https://github.com/.extraheader=${authHeader}`,
			'push',
			'origin',
			branchName
		]);
	} else {
		hooks.log(`la fecha de publicación ya coincidía con ${today}, sin cambios adicionales…`);
	}

	const finalSha = (await exec('git', ['-C', blogPath, 'rev-parse', 'HEAD'])).trim();

	// Wait for Vercel and CI check on the final commit
	hooks.log('verificando checks en verde antes del squash merge…');
	await pollChecks(token, config.blog.repo, finalSha, hooks.log, { timeoutMs: options.timeoutMs });

	// Squash merge PR
	hooks.log(`haciendo squash merge del PR #${prNumber}…`);
	await squashMerge(token, config.blog.repo, prNumber, {
		title: `post: ${postId} (${originalLang} → ${otherLang})`,
		message: `Co-Authored-By: ${config.git.coAuthor}`
	});

	// Delete remote branch
	hooks.log(`eliminando rama remota ${branchName}…`);
	await deleteBranch(token, config.blog.repo, branchName).catch((e) => {
		hooks.log(`aviso: no se pudo eliminar la rama remota (${(e as Error).message})`);
	});

	// Return local repo to master
	hooks.log(`actualizando rama master local en ${blogPath}…`);
	await exec('git', ['-C', blogPath, 'checkout', config.blog.branch]);
	await exec('git', ['-C', blogPath, 'pull', 'origin', config.blog.branch]);
	await exec('git', ['-C', blogPath, 'branch', '-D', branchName]).catch(() => {});

	// Mark job published
	job.status = 'published';
	job.publish = {
		...job.publish,
		branch: branchName,
		publishedAt: new Date().toISOString(),
		publishedDate: today
	};
	await saveJob(config, job);

	// Poll until Vercel production deployment completes on master
	hooks.log('esperando despliegue de producción en Vercel (~30s)…');
	const masterSha = (await exec('git', ['-C', blogPath, 'rev-parse', 'HEAD'])).trim();
	await pollChecks(token, config.blog.repo, masterSha, hooks.log, { timeoutMs: 90_000 }).catch(() => {});

	hooks.log(`Publicación completada exitosamente! 🎉`);
	hooks.log(`ES: ${urls.es}`);
	hooks.log(`EN: ${urls.en}`);

	return { urls, shareTexts, audiogramPath };
}

/**
 * Unpublish: creates PR setting draft: true on the post.
 */
export async function unpublishPost(
	config: Config,
	postId: string,
	hooks: PublishHooks,
	options: { confirm?: boolean } = {}
): Promise<{ pr: GitHubPullRequest; unpublished?: boolean }> {
	const token = getGithubToken();
	const blogPath = config.blog.path;
	hooks.log(`verificando estado de ${blogPath}…`);
	await assertCleanRepo(blogPath);

	const targetDir = join(blogPath, 'src/content/posts', postId);
	const files = await readdir(targetDir).catch(() => {
		throw new Error(`Post no encontrado en el blog: ${targetDir}`);
	});

	const branchName = `unpublish/${postId}`;
	const author = await getGitAuthor(config, blogPath);
	const authHeader = getAuthHeader(token);

	hooks.log(`preparando rama ${branchName} desde master…`);
	await exec('git', ['-C', blogPath, 'fetch', 'origin', config.blog.branch]);
	await exec('git', ['-C', blogPath, 'checkout', '-B', branchName, `origin/${config.blog.branch}`]);

	for (const lang of ['en', 'es'] as const) {
		if (!files.includes(`${lang}.md`)) continue;
		const file = join(targetDir, `${lang}.md`);
		const raw = await readFile(file, 'utf8');
		const { data, body } = splitFrontmatter(raw);
		const fm = PostFrontmatter.parse({ ...(data as Record<string, unknown>), draft: true });
		await writeFile(file, renderMarkdown(fm, body));
	}

	await exec('git', ['-C', blogPath, 'add', `src/content/posts/${postId}`]);
	const commitMsg = `unpublish: ${postId}\n\nCo-Authored-By: ${config.git.coAuthor}`;
	await exec('git', ['-C', blogPath, 'commit', '-m', commitMsg], {
		env: {
			GIT_AUTHOR_NAME: author.name,
			GIT_AUTHOR_EMAIL: author.email,
			GIT_COMMITTER_NAME: author.name,
			GIT_COMMITTER_EMAIL: author.email
		}
	});

	hooks.log(`haciendo push a origin ${branchName}…`);
	await exec('git', [
		'-C',
		blogPath,
		'-c',
		`http.https://github.com/.extraheader=${authHeader}`,
		'push',
		'-u',
		'origin',
		branchName,
		'--force-with-lease'
	]);

	const commitSha = (await exec('git', ['-C', blogPath, 'rev-parse', 'HEAD'])).trim();

	let pr = await findOpenPullRequest(token, config.blog.repo, branchName);
	if (!pr) {
		pr = await createPullRequest(token, config.blog.repo, {
			title: `unpublish: ${postId}`,
			head: branchName,
			base: config.blog.branch,
			body: `Set \`draft: true\` for post \`${postId}\`.`
		});
	}
	hooks.log(`PR para despublicar: ${pr.html_url}`);

	if (options.confirm) {
		hooks.log('esperando checks para despublicar…');
		await pollChecks(token, config.blog.repo, commitSha, hooks.log);
		await squashMerge(token, config.blog.repo, pr.number, {
			title: `unpublish: ${postId}`,
			message: `Co-Authored-By: ${config.git.coAuthor}`
		});
		await deleteBranch(token, config.blog.repo, branchName).catch(() => {});
		await exec('git', ['-C', blogPath, 'checkout', config.blog.branch]);
		await exec('git', ['-C', blogPath, 'pull', 'origin', config.blog.branch]);
		await exec('git', ['-C', blogPath, 'branch', '-D', branchName]).catch(() => {});
		hooks.log(`Post ${postId} despublicado exitosamente.`);
		return { pr, unpublished: true };
	}

	return { pr, unpublished: false };
}
