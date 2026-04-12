import net from 'node:net';
import { config } from '../config.js';

const TELNET_TIMEOUT_MS = 3_000;

function parseResponse(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== 'END');
}

function parseMetadata(lines: string[]): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    metadata[key] =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;
  }

  return metadata;
}

function extractResponseFrame(
  buffer: string,
): {
  response: string;
  remainder: string;
} | null {
  for (const delimiter of ['\nEND\r\n', '\nEND\n', 'END\r\n', 'END\n']) {
    const index = buffer.indexOf(delimiter);
    if (index === -1) {
      continue;
    }

    return {
      response: buffer.slice(0, index),
      remainder: buffer.slice(index + delimiter.length),
    };
  }

  return null;
}

async function withTelnetSession<T>(
  run: (send: (command: string) => Promise<string[]>) => Promise<T>,
): Promise<T> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.LIQUIDSOAP_TELNET_HOST,
      port: config.LIQUIDSOAP_TELNET_PORT,
    });
    socket.setEncoding('utf8');

    let buffer = '';
    let settled = false;
    let activeCommand: {
      command: string;
      resolve: (lines: string[]) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    } | null = null;

    const fail = (error: Error): void => {
      if (activeCommand) {
        clearTimeout(activeCommand.timeout);
        activeCommand.reject(error);
        activeCommand = null;
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const maybeResolveCommand = (): void => {
      if (!activeCommand) {
        return;
      }

      const frame = extractResponseFrame(buffer);
      if (!frame) {
        return;
      }

      const current = activeCommand;
      activeCommand = null;
      buffer = frame.remainder;
      clearTimeout(current.timeout);
      current.resolve(parseResponse(frame.response));
    };

    const send = async (command: string): Promise<string[]> => {
      if (activeCommand) {
        throw new Error(`Liquidsoap session already has an active command: ${activeCommand.command}`);
      }
      if (settled) {
        throw new Error(`Liquidsoap session already closed before sending: ${command}`);
      }

      return await new Promise<string[]>((resolveCommand, rejectCommand) => {
        activeCommand = {
          command,
          resolve: resolveCommand,
          reject: rejectCommand,
          timeout: setTimeout(() => {
            socket.destroy(new Error(`Liquidsoap command timed out: ${command}`));
          }, TELNET_TIMEOUT_MS),
        };
        socket.write(`${command}\n`);
      });
    };

    socket.on('connect', () => {
      void run(send)
        .then((result) => {
          if (!settled) {
            settled = true;
            socket.end('quit\n');
            resolve(result);
          }
        })
        .catch((error) => {
          socket.destroy(error instanceof Error ? error : new Error(String(error)));
        });
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      maybeResolveCommand();
    });

    socket.on('error', (error) => {
      fail(error);
    });

    socket.on('close', () => {
      if (!settled) {
        fail(
          new Error(
            activeCommand
              ? `Liquidsoap closed the connection before returning a response for: ${activeCommand.command}`
              : 'Liquidsoap closed the connection unexpectedly',
          ),
        );
      }
    });
  });
}

async function sendCommand(command: string): Promise<string[]> {
  return await withTelnetSession(async (send) => await send(command));
}

export async function getQueue(): Promise<string[]> {
  return await sendCommand('queue.queue');
}

export interface LiquidsoapCurrentRequest {
  requestId: string;
  filePath: string | null;
}

export interface LiquidsoapStreamState {
  checkedAt: string;
  currentRequest: LiquidsoapCurrentRequest | null;
  online: boolean;
  queue: string[];
  remainingSeconds: number | null;
}

export async function getRequestMetadata(requestId: string): Promise<LiquidsoapCurrentRequest> {
  const metadata = parseMetadata(await sendCommand(`request.metadata ${requestId}`));
  return {
    requestId,
    filePath: metadata.filename ?? metadata.initial_uri ?? null,
  };
}

export async function getCurrentRequest(): Promise<LiquidsoapCurrentRequest | null> {
  const requestIds = (await sendCommand('request.all')).flatMap((line) =>
    line.split(/\s+/).filter(Boolean),
  );
  const requestId = requestIds[0];

  if (!requestId) {
    return null;
  }

  return await getRequestMetadata(requestId);
}

export async function getRemainingSeconds(): Promise<number | null> {
  const raw = await sendCommand('output.icecast.remaining');
  const value = raw[0];

  if (!value) {
    return null;
  }

  const remaining = Number.parseFloat(value);
  return Number.isFinite(remaining) ? remaining : null;
}

export async function pollLiquidsoapState(now = new Date()): Promise<LiquidsoapStreamState> {
  return await withTelnetSession(async (send) => {
    const requestIds = (await send('request.all')).flatMap((line) =>
      line.split(/\s+/).filter(Boolean),
    );
    const requestId = requestIds[0] ?? null;
    const currentRequest = requestId ? await getCurrentRequestFromSession(send, requestId) : null;
    const remainingRaw = await send('output.icecast.remaining');
    const queue = await send('queue.queue');

    return {
      checkedAt: now.toISOString(),
      currentRequest,
      online: true,
      queue,
      remainingSeconds: parseRemainingSeconds(remainingRaw),
    };
  });
}

export async function pushQueue(uri: string): Promise<{ requestId: string | null; raw: string[] }> {
  const raw = await sendCommand(`queue.push ${uri}`);
  return {
    requestId: raw[0] ?? null,
    raw,
  };
}

export async function skipCurrentTrack(): Promise<{ raw: string[] }> {
  const raw = await sendCommand('output.icecast.skip');
  return { raw };
}

export async function pingLiquidsoap(): Promise<boolean> {
  try {
    await pollLiquidsoapState();
    return true;
  } catch {
    return false;
  }
}

async function getCurrentRequestFromSession(
  send: (command: string) => Promise<string[]>,
  requestId: string,
): Promise<LiquidsoapCurrentRequest> {
  const metadata = parseMetadata(await send(`request.metadata ${requestId}`));
  return {
    requestId,
    filePath: metadata.filename ?? metadata.initial_uri ?? null,
  };
}

function parseRemainingSeconds(raw: string[]): number | null {
  const value = raw[0];

  if (!value) {
    return null;
  }

  const remaining = Number.parseFloat(value);
  return Number.isFinite(remaining) ? remaining : null;
}
