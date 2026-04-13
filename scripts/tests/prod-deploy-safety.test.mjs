import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('prod deploy tooling includes self-healing TLS config and a fast stream check entrypoint', async () => {
  const [
    ciWorkflow,
    deployScript,
    makefile,
    gitignore,
    tlsExample,
  ] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'scripts', 'deploy.sh'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'Makefile'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, '.gitignore'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'nginx', 'conf.d-extra', '50-subdomain-tls.conf.example'), 'utf8'),
  ]);

  assert.match(
    deployScript,
    /REMOTE_HOST="\$\{DUCKFEED_REMOTE_HOST:-duck-ts\}"/,
    'deploy script should default to the working Tailscale management host',
  );
  assert.match(
    deployScript,
    /docker-compose\.prod\.local\.example\.yml/,
    'deploy script should self-heal a missing prod local compose file from the checked-in example',
  );
  assert.match(
    deployScript,
    /50-subdomain-tls\.conf\.example/,
    'deploy script should self-heal a missing TLS vhost config from the checked-in example',
  );
  assert.match(
    deployScript,
    /check-public-stream\.mjs".*--quick/,
    'deploy script should validate the public stream after a backend rollout',
  );

  assert.match(
    makefile,
    /^stream-check:.*## /m,
    'Makefile should expose the full public stream validation command',
  );
  assert.match(
    makefile,
    /check-public-stream\.mjs/,
    'stream-check target should invoke the public stream validation script',
  );
  assert.match(
    makefile,
    /^stream-check-quick:.*## /m,
    'Makefile should expose a quick stream validation target for deploy smoke checks',
  );
  assert.match(
    makefile,
    /^link-check:.*## /m,
    'Makefile should expose a markdown link-check target',
  );
  assert.match(
    makefile,
    /check-markdown-links\.mjs/,
    'link-check target should invoke the tracked markdown link checker',
  );

  assert.match(
    tlsExample,
    /server_name api\.duckfeed\.cmr\.my;/,
    'TLS example should include the API vhost',
  );
  assert.match(
    tlsExample,
    /server_name stream\.duckfeed\.cmr\.my;/,
    'TLS example should include the stream vhost',
  );

  assert.match(
    gitignore,
    /!\/nginx\/conf\.d-extra\/\*\.example/,
    '.gitignore should allow checked-in nginx conf.d-extra examples',
  );
  assert.match(
    ciWorkflow,
    /node scripts\/check-markdown-links\.mjs/,
    'CI should run the tracked markdown link checker',
  );
});
