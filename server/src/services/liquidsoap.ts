import net from 'node:net';
import { config } from '../config.js';

const TELNET_TIMEOUT_MS = 3_000;
const UNSUPPORTED_COMMAND_PATTERNS = [/^ERROR:\s+unknown command/i, /^No such command:/i];

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

class LiquidsoapCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly responseLines: string[],
  ) {
    super(`Liquidsoap command failed: ${command}: ${responseLines[0] ?? 'unknown error'}`);
  }
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
      const responseLines = parseResponse(frame.response);
      const responseError = parseCommandError(current.command, responseLines);

      if (responseError) {
        current.reject(responseError);
        return;
      }

      current.resolve(responseLines);
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
  requestId: string | null;
  filePath: string | null;
  artist?: string | null;
  title?: string | null;
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

export async function getCurrentFile(): Promise<string | null> {
  const current = await getCurrentRequest();
  return current?.filePath ?? null;
}

export async function getCurrentRequest(): Promise<LiquidsoapCurrentRequest | null> {
  return await withTelnetSession(async (send) => await getCurrentRequestFromSession(send));
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
    const currentRequest = await getCurrentRequestFromSession(send);
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

function quoteTelnetString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function setInteractiveString(name: string, value: string): Promise<string[]> {
  return await sendCommand(`var.set ${name} = ${quoteTelnetString(value)}`);
}

export async function setInteractiveBool(name: string, value: boolean): Promise<string[]> {
  return await sendCommand(`var.set ${name} = ${value ? 'true' : 'false'}`);
}

export async function pingLiquidsoap(): Promise<boolean> {
  try {
    await pollLiquidsoapState();
    return true;
  } catch {
    return false;
  }
}

function parseRemainingSeconds(raw: string[]): number | null {
  const value = raw[0];

  if (!value) {
    return null;
  }

  const remaining = Number.parseFloat(value);
  return Number.isFinite(remaining) ? remaining : null;
}

async function getCurrentRequestFromSession(
  send: (command: string) => Promise<string[]>,
): Promise<LiquidsoapCurrentRequest | null> {
  // Try the atomic current.metadata command first (tab-delimited:
  // filename\ttitle\tartist). All three fields are captured in a single
  // on_metadata callback and stored in one ref, so they are always from the
  // same track — no inter-query race conditions.
  const metadataLines = await sendOptionalCommand(send, 'current.metadata');
  const metadataLine = metadataLines[0] ?? '';

  if (metadataLine.includes('\t')) {
    const [filePath, title, artist] = metadataLine.split('\t');
    const trimmedFile = filePath?.trim() || null;
    const trimmedTitle = title?.trim() || null;
    const trimmedArtist = artist?.trim() || null;

    if (!trimmedFile && !trimmedTitle && !trimmedArtist) {
      return null;
    }

    return {
      requestId: null,
      filePath: trimmedFile,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      ...(trimmedArtist ? { artist: trimmedArtist } : {}),
    };
  }

  // Fallback for older Liquidsoap configs without current.metadata:
  // use output.icecast.metadata.
  const outputMetadataLines = await sendOptionalCommand(send, 'output.icecast.metadata');
  const outputMetadata = parseOutputMetadata(outputMetadataLines);
  const title = outputMetadata.title ?? null;
  const artist = outputMetadata.artist ?? null;
  const filePath = outputMetadata.filename ?? null;

  if (!filePath && !title && !artist) {
    return null;
  }

  return {
    requestId: null,
    filePath,
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
  };
}

async function sendOptionalCommand(
  send: (command: string) => Promise<string[]>,
  command: string,
): Promise<string[]> {
  try {
    return await send(command);
  } catch (error) {
    if (isUnsupportedCommandError(error)) {
      return [];
    }
    throw error;
  }
}

function parseOutputMetadata(lines: string[]): Record<string, string> {
  if (lines.length === 0) {
    return {};
  }

  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (/^---\s+\d+\s+---$/.test(line)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [];
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return parseMetadata(blocks[0] ?? lines);
}

function parseCommandError(command: string, responseLines: string[]): LiquidsoapCommandError | null {
  const firstLine = responseLines[0];
  if (!firstLine) {
    return null;
  }

  if (UNSUPPORTED_COMMAND_PATTERNS.some((pattern) => pattern.test(firstLine))) {
    return new LiquidsoapCommandError(command, responseLines);
  }

  return null;
}

function isUnsupportedCommandError(error: unknown): error is LiquidsoapCommandError {
  if (!(error instanceof LiquidsoapCommandError)) {
    return false;
  }

  const firstLine = error.responseLines[0] ?? '';
  return UNSUPPORTED_COMMAND_PATTERNS.some((pattern) => pattern.test(firstLine));
}
