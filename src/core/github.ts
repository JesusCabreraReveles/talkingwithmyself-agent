// GitHub REST API wrapper for PRs, commit statuses, check-runs and squash-merging.
export type GitHubPullRequest = {
	number: number;
	html_url: string;
	state: string;
	head: { sha: string; ref: string };
	base: { ref: string };
};

export type GitHubCommitStatus = {
	id: number;
	state: 'pending' | 'success' | 'failure' | 'error';
	context: string;
	description: string;
	target_url: string;
};

export type GitHubCheckRun = {
	name: string;
	status: 'queued' | 'in_progress' | 'completed';
	conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
	details_url: string;
};

export type GitHubDeployment = {
	id: number;
	ref: string;
	environment: string;
	statuses_url: string;
};

export type GitHubDeploymentStatus = {
	state: 'pending' | 'success' | 'failure' | 'error';
	environment_url?: string;
	target_url?: string;
};

export type GitHubIssueComment = {
	id: number;
	body: string;
	user?: { login: string };
};

async function githubFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	const url = path.startsWith('https://') ? path : `https://api.github.com${path}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'User-Agent': 'twm-agent',
		...(init.headers as Record<string, string>)
	};
	const res = await fetch(url, { ...init, headers });
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
	}
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

export async function findOpenPullRequest(
	token: string,
	repo: string,
	headBranch: string
): Promise<GitHubPullRequest | null> {
	const owner = repo.split('/')[0];
	const pulls = await githubFetch<GitHubPullRequest[]>(
		token,
		`/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${headBranch}`)}&state=open`
	);
	return pulls[0] ?? null;
}

export async function createPullRequest(
	token: string,
	repo: string,
	params: { title: string; head: string; base: string; body: string }
): Promise<GitHubPullRequest> {
	return githubFetch<GitHubPullRequest>(token, `/repos/${repo}/pulls`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params)
	});
}

export async function getCombinedStatus(
	token: string,
	repo: string,
	sha: string
): Promise<{ state: string; statuses: GitHubCommitStatus[] }> {
	return githubFetch<{ state: string; statuses: GitHubCommitStatus[] }>(token, `/repos/${repo}/commits/${sha}/status`);
}

export async function getCheckRuns(token: string, repo: string, sha: string): Promise<GitHubCheckRun[]> {
	const data = await githubFetch<{ check_runs: GitHubCheckRun[] }>(token, `/repos/${repo}/commits/${sha}/check-runs`);
	return data.check_runs ?? [];
}

export async function getDeployments(token: string, repo: string, ref: string): Promise<GitHubDeployment[]> {
	return githubFetch<GitHubDeployment[]>(token, `/repos/${repo}/deployments?ref=${encodeURIComponent(ref)}`);
}

export async function getDeploymentStatuses(token: string, statusesUrl: string): Promise<GitHubDeploymentStatus[]> {
	return githubFetch<GitHubDeploymentStatus[]>(token, statusesUrl);
}

export async function getIssueComments(
	token: string,
	repo: string,
	issueNumber: number
): Promise<GitHubIssueComment[]> {
	return githubFetch<GitHubIssueComment[]>(token, `/repos/${repo}/issues/${issueNumber}/comments`);
}

/**
 * Searches for a Vercel preview URL across deployments, PR comments, and commit statuses.
 */
export async function findPreviewUrl(
	token: string,
	repo: string,
	sha: string,
	prNumber?: number
): Promise<string | null> {
	// 1. Check Deployments
	try {
		const deployments = await getDeployments(token, repo, sha);
		for (const d of deployments) {
			const statuses = await getDeploymentStatuses(token, d.statuses_url);
			for (const s of statuses) {
				if (s.environment_url && /https?:\/\/[^\s]+/.test(s.environment_url)) {
					return s.environment_url;
				}
			}
		}
	} catch {}

	// 2. Check PR comments for Vercel bot preview links
	if (prNumber) {
		try {
			const comments = await getIssueComments(token, repo, prNumber);
			for (const c of comments) {
				// Match markdown link: [Visit Preview](https://cabrera-systems-blog-git-....vercel.app)
				const m = /https:\/\/[a-zA-Z0-9_-]+\.vercel\.app\b[^\s)]*/.exec(c.body);
				if (m) return m[0];
			}
		} catch {}
	}

	// 3. Check commit statuses (Vercel target_url)
	try {
		const combined = await getCombinedStatus(token, repo, sha);
		const vercel = combined.statuses.find((s) => s.context === 'Vercel');
		if (vercel && vercel.target_url) {
			// If target_url is direct vercel.app link
			if (/https:\/\/[a-zA-Z0-9_-]+\.vercel\.app/.test(vercel.target_url)) {
				return vercel.target_url;
			}
		}
	} catch {}

	return null;
}

export type PreviewPollResult = {
	previewUrl: string;
	vercelStatus: 'success';
	ciStatus?: 'success';
};

/**
 * Polls for Vercel deployment completion and extracts the preview URL.
 */
export async function pollPreview(
	token: string,
	repo: string,
	sha: string,
	prNumber?: number,
	onProgress?: (msg: string) => void,
	opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<PreviewPollResult> {
	const timeoutMs = opts.timeoutMs ?? 300_000;
	const intervalMs = opts.intervalMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const combined = await getCombinedStatus(token, repo, sha);
		const vercel = combined.statuses.find((s) => s.context === 'Vercel');
		const checks = await getCheckRuns(token, repo, sha);
		const ciCheck = checks.find((c) => c.name === 'check');

		if (vercel) {
			if (vercel.state === 'failure' || vercel.state === 'error') {
				throw new Error(`Vercel deployment failed: ${vercel.description} (${vercel.target_url})`);
			}
			if (vercel.state === 'success') {
				const previewUrl = await findPreviewUrl(token, repo, sha, prNumber);
				if (previewUrl) {
					onProgress?.(`Vercel preview listo: ${previewUrl}`);
					return {
						previewUrl,
						vercelStatus: 'success',
						ciStatus: ciCheck?.conclusion === 'success' ? 'success' : undefined
					};
				}
				// Sometimes deployment succeeded but URL takes a few seconds to appear
				onProgress?.('Vercel deployment completado, esperando URL…');
			} else {
				onProgress?.(`Vercel construyendo… (${vercel.state}: ${vercel.description || 'en progreso'})`);
			}
		} else {
			onProgress?.('Esperando que Vercel inicie el build…');
		}

		if (ciCheck) {
			if (ciCheck.status === 'completed' && ciCheck.conclusion === 'failure') {
				throw new Error(`CI check failed: ${ciCheck.details_url}`);
			}
		}

		await new Promise((r) => setTimeout(r, intervalMs));
	}

	throw new Error(`Timeout de preview (${Math.round(timeoutMs / 1000)}s) alcanzado para commit ${sha}`);
}

/**
 * Polls until required checks ('check' and 'Vercel') succeed for a commit before merging.
 */
export async function pollChecks(
	token: string,
	repo: string,
	sha: string,
	onProgress?: (msg: string) => void,
	opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
	const timeoutMs = opts.timeoutMs ?? 300_000;
	const intervalMs = opts.intervalMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const combined = await getCombinedStatus(token, repo, sha);
		const vercel = combined.statuses.find((s) => s.context === 'Vercel');
		const checks = await getCheckRuns(token, repo, sha);
		const ciCheck = checks.find((c) => c.name === 'check');

		const vercelDone = vercel?.state === 'success';
		const ciDone = ciCheck?.status === 'completed' && ciCheck?.conclusion === 'success';

		if (vercel?.state === 'failure' || vercel?.state === 'error') {
			throw new Error(`Vercel check failed: ${vercel.description} (${vercel.target_url})`);
		}
		if (ciCheck?.status === 'completed' && ciCheck?.conclusion === 'failure') {
			throw new Error(`CI check failed: ${ciCheck.details_url}`);
		}

		if (vercelDone && ciDone) {
			onProgress?.('Todos los checks (CI check + Vercel) en verde ✅');
			return;
		}

		const pendingParts: string[] = [];
		if (!ciDone) pendingParts.push(`CI: ${ciCheck?.status ?? 'esperando'}`);
		if (!vercelDone) pendingParts.push(`Vercel: ${vercel?.state ?? 'esperando'}`);
		onProgress?.(`Esperando checks: ${pendingParts.join(', ')}…`);

		await new Promise((r) => setTimeout(r, intervalMs));
	}

	throw new Error(`Timeout esperando checks (${Math.round(timeoutMs / 1000)}s) para commit ${sha}`);
}

export async function squashMerge(
	token: string,
	repo: string,
	prNumber: number,
	params: { title: string; message: string }
): Promise<{ sha: string; merged: boolean }> {
	return githubFetch<{ sha: string; merged: boolean }>(token, `/repos/${repo}/pulls/${prNumber}/merge`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			merge_method: 'squash',
			commit_title: params.title,
			commit_message: params.message
		})
	});
}

export async function deleteBranch(token: string, repo: string, branch: string): Promise<void> {
	await githubFetch<void>(token, `/repos/${repo}/git/refs/heads/${branch}`, {
		method: 'DELETE'
	});
}

export type GitHubFile = { sha: string; content: string };

/** Reads a file through the contents API. null when it does not exist (404). */
export async function getRepoFile(token: string, repo: string, path: string, ref: string): Promise<GitHubFile | null> {
	try {
		const data = await githubFetch<{ sha: string; content: string; encoding: string }>(
			token,
			`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`
		);
		return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
	} catch (e) {
		if (/\(404\)/.test((e as Error).message)) return null;
		throw e;
	}
}

/** Creates a new file on `branch` (fails with 422 if it already exists). Returns the commit SHA. */
export async function createRepoFile(
	token: string,
	repo: string,
	params: { path: string; branch: string; content: string; message: string; author: { name: string; email: string } }
): Promise<string> {
	const res = await githubFetch<{ commit: { sha: string } }>(
		token,
		`/repos/${repo}/contents/${params.path.split('/').map(encodeURIComponent).join('/')}`,
		{
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: params.message,
				content: Buffer.from(params.content, 'utf8').toString('base64'),
				branch: params.branch,
				author: params.author,
				committer: params.author
			})
		}
	);
	return res.commit.sha;
}
