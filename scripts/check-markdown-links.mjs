#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const CHECK_EXTERNAL = process.env.DUCKFEED_LINK_CHECK_EXTERNAL !== '0';

async function main() {
  const markdownFiles = listTrackedMarkdownFiles();
  const anchorCache = new Map();
  const checkedExternalUrls = new Map();
  const errors = [];
  let checkedReferences = 0;

  for (const relativeFile of markdownFiles) {
    const absoluteFile = path.join(REPO_ROOT, relativeFile);
    const content = await readFile(absoluteFile, 'utf8');
    const references = collectReferences(relativeFile, content);

    for (const reference of references) {
      checkedReferences += 1;

      try {
        await validateReference(reference, anchorCache, checkedExternalUrls);
      } catch (error) {
        errors.push(
          `${relativeFile}:${reference.line} ${reference.target} -> ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('Broken markdown links detected:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `Checked ${checkedReferences} markdown references across ${markdownFiles.length} tracked Markdown file(s)`,
  );
}

function listTrackedMarkdownFiles() {
  const output = execFileSync('git', ['ls-files', '*.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();

  if (output.length === 0) {
    return [];
  }

  return output.split('\n');
}

function collectReferences(relativeFile, content) {
  const stripped = stripCodeBlocks(content);
  const references = [];

  const markdownPattern = /!?\[[^\]]*]\(([^)\n]+)\)/g;
  for (const match of stripped.matchAll(markdownPattern)) {
    const rawTarget = normaliseBracketTarget(match[1] ?? '');
    if (!rawTarget) {
      continue;
    }

    references.push({
      line: lineNumberForIndex(stripped, match.index ?? 0),
      source: relativeFile,
      target: rawTarget,
    });
  }

  const htmlPattern = /<(a|img)\b[^>]*\b(href|src)=["']([^"']+)["'][^>]*>/gi;
  for (const match of stripped.matchAll(htmlPattern)) {
    const rawTarget = match[3]?.trim();
    if (!rawTarget) {
      continue;
    }

    references.push({
      line: lineNumberForIndex(stripped, match.index ?? 0),
      source: relativeFile,
      target: rawTarget,
    });
  }

  return references;
}

async function validateReference(reference, anchorCache, checkedExternalUrls) {
  if (shouldIgnoreTarget(reference.target)) {
    return;
  }

  if (isExternalTarget(reference.target)) {
    if (!CHECK_EXTERNAL) {
      return;
    }

    await validateExternalTarget(reference.target, checkedExternalUrls);
    return;
  }

  const [rawPath, fragment] = splitFragment(reference.target);
  const sourceAbsolutePath = path.join(REPO_ROOT, reference.source);
  const targetAbsolutePath = resolveLocalTargetPath(sourceAbsolutePath, rawPath);

  await access(targetAbsolutePath, constants.F_OK);

  if (!fragment) {
    return;
  }

  const anchors = await collectAnchors(targetAbsolutePath, anchorCache);
  if (!anchors.has(fragment)) {
    throw new Error(`missing anchor #${fragment}`);
  }
}

function shouldIgnoreTarget(target) {
  return target.startsWith('mailto:') || target.startsWith('data:');
}

function isExternalTarget(target) {
  return /^https?:\/\//i.test(target);
}

function splitFragment(target) {
  const hashIndex = target.indexOf('#');
  if (hashIndex === -1) {
    return [target, ''];
  }

  return [target.slice(0, hashIndex), decodeURIComponent(target.slice(hashIndex + 1))];
}

function resolveLocalTargetPath(sourceAbsolutePath, rawPath) {
  if (!rawPath) {
    return sourceAbsolutePath;
  }

  if (rawPath.startsWith('/')) {
    return path.join(REPO_ROOT, rawPath.slice(1));
  }

  return path.resolve(path.dirname(sourceAbsolutePath), rawPath);
}

async function collectAnchors(targetAbsolutePath, anchorCache) {
  if (anchorCache.has(targetAbsolutePath)) {
    return anchorCache.get(targetAbsolutePath);
  }

  const content = await readFile(targetAbsolutePath, 'utf8');
  const stripped = stripCodeBlocks(content);
  const anchors = new Set();
  const slugCounts = new Map();
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;

  for (const match of stripped.matchAll(headingPattern)) {
    const headingText = match[2]?.trim();
    if (!headingText) {
      continue;
    }

    const baseSlug = slugifyHeading(headingText);
    if (!baseSlug) {
      continue;
    }

    const nextCount = slugCounts.get(baseSlug) ?? 0;
    const slug = nextCount === 0 ? baseSlug : `${baseSlug}-${nextCount}`;
    slugCounts.set(baseSlug, nextCount + 1);
    anchors.add(slug);
  }

  anchorCache.set(targetAbsolutePath, anchors);
  return anchors;
}

function slugifyHeading(headingText) {
  return headingText
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function validateExternalTarget(target, checkedExternalUrls) {
  if (checkedExternalUrls.has(target)) {
    const cached = checkedExternalUrls.get(target);
    if (cached instanceof Error) {
      throw cached;
    }
    return;
  }

  try {
    let response = await fetch(target, {
      headers: {
        'user-agent': 'duckfeed-link-check/1.0',
      },
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 403 || response.status === 405 || response.status === 501) {
      response = await fetch(target, {
        headers: {
          range: 'bytes=0-0',
          'user-agent': 'duckfeed-link-check/1.0',
        },
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
    }

    if (response.status < 200 || response.status >= 400) {
      throw new Error(`HTTP ${response.status}`);
    }

    checkedExternalUrls.set(target, true);
  } catch (error) {
    const wrapped =
      error instanceof Error ? error : new Error(`link check failed: ${String(error)}`);
    checkedExternalUrls.set(target, wrapped);
    throw wrapped;
  }
}

function normaliseBracketTarget(rawTarget) {
  let target = rawTarget.trim();

  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1);
  }

  const titleSeparator = target.match(/\s+['"]/);
  if (titleSeparator) {
    target = target.slice(0, titleSeparator.index).trim();
  }

  return target;
}

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, '');
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
