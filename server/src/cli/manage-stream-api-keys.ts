import { exit } from 'node:process';
import { pool } from '../db/index.js';
import {
  createStreamApiKey,
  listStreamApiKeys,
  revokeStreamApiKey,
} from '../services/stream-api-keys.js';

function printUsage(): void {
  console.log('Usage:');
  console.log('  node dist/cli/manage-stream-api-keys.js list');
  console.log('  node dist/cli/manage-stream-api-keys.js create <label>');
  console.log('  node dist/cli/manage-stream-api-keys.js revoke <id>');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'list': {
      const apiKeys = await listStreamApiKeys();
      if (apiKeys.length === 0) {
        console.log('No stream API keys found.');
        return;
      }

      console.table(
        apiKeys.map((apiKey) => ({
          id: apiKey.id,
          label: apiKey.label,
          prefix: apiKey.keyPrefix,
          status: apiKey.revokedAt ? 'revoked' : 'active',
          lastUsedAt: apiKey.lastUsedAt ?? 'never',
          createdAt: apiKey.createdAt,
        })),
      );
      return;
    }

    case 'create': {
      const label = args.join(' ').trim();
      if (!label) {
        throw new Error('Label is required');
      }

      const result = await createStreamApiKey(label);
      console.log(`Created stream API key for "${result.record.label}"`);
      console.log(`ID: ${result.record.id}`);
      console.log(`Prefix: ${result.record.keyPrefix}`);
      console.log(`Key: ${result.key}`);
      console.log('Store the key now. It will not be shown again.');
      return;
    }

    case 'revoke': {
      const id = args[0]?.trim();
      if (!id) {
        throw new Error('ID is required');
      }

      const result = await revokeStreamApiKey(id);
      console.log(`Revoked stream API key "${result.label}" (${result.id})`);
      return;
    }

    default:
      printUsage();
      if (command) {
        throw new Error(`Unknown command: ${command}`);
      }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    if (exitCode !== 0) {
      exit(exitCode);
    }
  });

let exitCode = 0;
