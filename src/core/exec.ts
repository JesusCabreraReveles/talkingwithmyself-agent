import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export async function exec(bin: string, args: string[]): Promise<string> {
	return (await execBoth(bin, args)).stdout;
}

export async function execBoth(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		return await pexec(bin, args, { maxBuffer: 64 * 1024 * 1024 });
	} catch (e) {
		const err = e as Error & { stderr?: string };
		throw new Error(`${bin} failed: ${(err.stderr || err.message).trim().slice(-800)}`);
	}
}
