import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free TCP port'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForServer(
  url: string,
  child: ChildProcessWithoutNullStreams,
  logs: { stdout: string; stderr: string },
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited before becoming ready (code ${child.exitCode})\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`,
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(200),
      });
      if (response.status > 0) {
        return;
      }
    } catch {
      // Keep polling until the deadline.
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for server readiness\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`);
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    delay(2_000).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

describe('API server', () => {
  let child: ChildProcessWithoutNullStreams | null = null;

  afterEach(async () => {
    if (child) {
      await stopChild(child);
      child = null;
    }
  });

  it('protects admin episode routes behind auth instead of leaving them unregistered', async () => {
    const port = await getFreePort();
    const logs = { stdout: '', stderr: '' };

    child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed',
        SESSION_SECRET: 'x'.repeat(64),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      logs.stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      logs.stderr += chunk.toString();
    });

    await waitForServer(`http://127.0.0.1:${port}/api/auth/me`, child, logs);

    const response = await fetch(`http://127.0.0.1:${port}/api/admin/episodes`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      data: null,
      error: {
        code: 'unauthorized',
        message: 'Authentication required',
      },
      meta: null,
    });
  });

  it('marks API responses as non-cacheable so live statuses do not stick in the browser', async () => {
    const port = await getFreePort();
    const logs = { stdout: '', stderr: '' };

    child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed',
        SESSION_SECRET: 'x'.repeat(64),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      logs.stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      logs.stderr += chunk.toString();
    });

    await waitForServer(`http://127.0.0.1:${port}/api/auth/me`, child, logs);

    const response = await fetch(`http://127.0.0.1:${port}/api/health`);

    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
  });
});
