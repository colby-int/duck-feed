// Thin promise wrapper around child_process.spawn (NOT shell exec).
// Rejects with a detailed error on non-zero exit. Captures stdout/stderr as strings.
// No shell interpolation — args are passed as an array, preventing injection.

import { spawn } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    public command: string,
    public args: readonly string[],
    public exitCode: number | null,
    public stdout: string,
    public stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new CommandError(
          `Failed to spawn ${command}: ${err.message}`,
          command,
          args,
          null,
          stdout,
          stderr,
        ),
      );
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(
          new CommandError(
            `${command} timed out after ${options.timeoutMs}ms`,
            command,
            args,
            code,
            stdout,
            stderr,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(
          new CommandError(
            `${command} exited with code ${code}`,
            command,
            args,
            code,
            stdout,
            stderr,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
