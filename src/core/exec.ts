import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export type ExecOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
};

export async function exec(bin: string, args: string[], opts?: ExecOptions): Promise<string> {
	return (await execBoth(bin, args, opts)).stdout;
}

export async function execBoth(
	bin: string,
	args: string[],
	opts?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
	try {
		return await pexec(bin, args, {
			maxBuffer: 64 * 1024 * 1024,
			cwd: opts?.cwd,
			env: opts?.env ? { ...process.env, ...opts.env } : process.env
		});
	} catch (e) {
		const err = e as Error & { stderr?: string };
		throw new Error(`${bin} failed: ${(err.stderr || err.message).trim().slice(-800)}`);
	}
}

/** Like execBoth, but hands each stderr line to `onLine` as it arrives (progress output). */
export function execStream(bin: string, args: string[], onLine: (line: string) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let tail = '';
		let partial = '';
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			tail = (tail + chunk).slice(-800);
			const lines = (partial + chunk).split('\n');
			partial = lines.pop()!;
			lines.forEach(onLine);
		});
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} failed: ${tail.trim()}`))));
	});
}
