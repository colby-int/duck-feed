import { config } from '../config.js';
import { logger } from '../lib/logger.js';

function extractListenersForMount(xml: string, mount: string): number | null {
  const escapedMount = mount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sourceMatch = xml.match(
    new RegExp(`<source[^>]*mount="${escapedMount}"[^>]*>[\\s\\S]*?<listeners>(\\d+)</listeners>`),
  );

  if (!sourceMatch?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(sourceMatch[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchCurrentListenerCount(): Promise<number> {
  if (!config.ICECAST_ADMIN_PASSWORD) {
    return 0;
  }

  try {
    const auth = Buffer.from(
      `${config.ICECAST_ADMIN_USERNAME}:${config.ICECAST_ADMIN_PASSWORD}`,
    ).toString('base64');
    const response = await fetch(
      `http://${config.ICECAST_HOST}:${config.ICECAST_PORT}/admin/stats`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      },
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, 'icecast: stats request failed');
      return 0;
    }

    const xml = await response.text();
    return extractListenersForMount(xml, '/stream') ?? 0;
  } catch (error) {
    logger.warn({ err: error }, 'icecast: failed to fetch listener count');
    return 0;
  }
}

export { extractListenersForMount };
