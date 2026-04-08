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

async function sendCommand(command: string): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.LIQUIDSOAP_TELNET_HOST,
      port: config.LIQUIDSOAP_TELNET_PORT,
    });
    socket.setEncoding('utf8');

    let resolved = false;
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy(new Error(`Liquidsoap command timed out: ${command}`));
    }, TELNET_TIMEOUT_MS);

    socket.on('connect', () => {
      socket.write(`${command}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk;
      const endIndex = buffer.indexOf('\nEND');
      if (endIndex === -1 || resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timeout);
      const response = buffer.slice(0, endIndex);
      socket.end('quit\n');
      resolve(parseResponse(response));
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        reject(error);
      }
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        reject(new Error(`Liquidsoap closed the connection before returning a response for: ${command}`));
      }
    });
  });
}

export async function getQueue(): Promise<string[]> {
  return await sendCommand('queue.queue');
}

export interface LiquidsoapCurrentRequest {
  requestId: string;
  filePath: string | null;
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
    await sendCommand('queue.queue');
    return true;
  } catch {
    return false;
  }
}
