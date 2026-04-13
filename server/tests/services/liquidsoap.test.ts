import net from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function startFakeLiquidsoap(
  responses: Record<string, string>,
): Promise<{ close: () => Promise<void>; port: number }> {
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;

      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n');
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        if (line === 'quit') {
          socket.write('Bye!\n');
          socket.end();
          return;
        }

        socket.write(responses[line] ?? 'END\n');
      }
    });

    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine fake Liquidsoap port');
  }

  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe('liquidsoap service', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://duckfeed:duckfeed@127.0.0.1:65535/duckfeed';
    process.env.SESSION_SECRET = 'x'.repeat(64);
    process.env.LOG_LEVEL = 'silent';
  });

  afterEach(() => {
    delete process.env.LIQUIDSOAP_TELNET_HOST;
    delete process.env.LIQUIDSOAP_TELNET_PORT;
  });

  it('falls back to output metadata when custom current-file commands are unavailable', async () => {
    const fakeLiquidsoap = await startFakeLiquidsoap({
      'current.file':
        'ERROR: unknown command, type "help" to get a list of commands."\nEND\n',
      'current.title':
        'ERROR: unknown command, type "help" to get a list of commands."\nEND\n',
      'current.artist':
        'ERROR: unknown command, type "help" to get a list of commands."\nEND\n',
      'output.icecast.metadata':
        '--- 1 ---\n' +
        'title="Home Sweet | Marley"\n' +
        'artist="Marley"\n' +
        'END\n',
      'output.icecast.remaining': '42\nEND\n',
      'queue.queue': '5\nEND\n',
    });

    process.env.LIQUIDSOAP_TELNET_HOST = '127.0.0.1';
    process.env.LIQUIDSOAP_TELNET_PORT = String(fakeLiquidsoap.port);

    try {
      const { pollLiquidsoapState } = await import('../../src/services/liquidsoap.js');
      const snapshot = await pollLiquidsoapState(new Date('2026-04-13T12:00:00.000Z'));

      expect(snapshot).toEqual({
        checkedAt: '2026-04-13T12:00:00.000Z',
        currentRequest: {
          artist: 'Marley',
          filePath: null,
          requestId: null,
          title: 'Home Sweet | Marley',
        },
        online: true,
        queue: ['5'],
        remainingSeconds: 42,
      });
    } finally {
      await fakeLiquidsoap.close();
    }
  });

  it('prefers callback-captured on-air metadata over output metadata when both are available', async () => {
    const fakeLiquidsoap = await startFakeLiquidsoap({
      'current.file': '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3\nEND\n',
      'current.title': 'Home Sweet | Marley\nEND\n',
      'current.artist': 'Marley\nEND\n',
      'output.icecast.metadata':
        '--- 1 ---\n' +
        'title="Stale Show | Wrong Host"\n' +
        'artist="Wrong Host"\n' +
        'END\n',
      'output.icecast.remaining': '42\nEND\n',
      'queue.queue': '5\nEND\n',
    });

    process.env.LIQUIDSOAP_TELNET_HOST = '127.0.0.1';
    process.env.LIQUIDSOAP_TELNET_PORT = String(fakeLiquidsoap.port);

    try {
      const { pollLiquidsoapState } = await import('../../src/services/liquidsoap.js');
      const snapshot = await pollLiquidsoapState(new Date('2026-04-13T12:00:00.000Z'));

      expect(snapshot.currentRequest).toEqual({
        artist: 'Marley',
        filePath: '/var/lib/duckfeed/library/2026-02-08-homesweet-6c28ab.mp3',
        requestId: null,
        title: 'Home Sweet | Marley',
      });
    } finally {
      await fakeLiquidsoap.close();
    }
  });
});
