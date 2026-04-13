#!/usr/bin/env node

import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_STREAM_URL = process.env.DUCKFEED_STREAM_URL ?? 'https://stream.duckfeed.cmr.my/stream';
const DEFAULT_SAMPLE_DURATION_SECONDS = Number.parseInt(
  process.env.DUCKFEED_STREAM_CHECK_DURATION ?? '8',
  10,
);
const QUICK_SAMPLE_DURATION_SECONDS = 5;
const SPECTRAL_FILTER =
  'aspectralstats=measure=flatness+centroid+entropy+crest,ametadata=print:file=-';

const MONOTONE_THRESHOLDS = {
  minFrames: 20,
  maxMedianEntropy: 0.08,
  maxMedianFlatness: 0.012,
  maxCentroidStdDev: 120,
  minMedianCrest: 100,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'duckfeed-stream-check-'));
  await mkdir(outputDir, { recursive: true });
  const sampleDurationSeconds = options.quick
    ? QUICK_SAMPLE_DURATION_SECONDS
    : DEFAULT_SAMPLE_DURATION_SECONDS;

  console.log(`Checking stream: ${DEFAULT_STREAM_URL}`);
  console.log(`Artifacts: ${outputDir}`);
  console.log(`Mode: ${options.quick ? 'quick' : 'full'}`);

  const response = await requestHeaders(DEFAULT_STREAM_URL);
  assertHeaderRequirements(response);

  console.log(`HTTP ${response.statusCode} ${response.statusMessage}`);
  console.log(`Content-Type: ${response.headers['content-type'] ?? '<missing>'}`);
  console.log(`Access-Control-Allow-Origin: ${response.accessControlAllowOriginValues.join(', ')}`);

  const samplePath = path.join(outputDir, 'sample.mp3');
  const spectrogramPath = path.join(outputDir, 'spectrogram.png');

  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-t',
    String(sampleDurationSeconds),
    '-i',
    DEFAULT_STREAM_URL,
    '-c:a',
    'copy',
    samplePath,
  ]);

  const ffprobeJson = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    samplePath,
  ]);
  const ffprobe = JSON.parse(ffprobeJson.stdout);
  const audioStream = ffprobe.streams?.find((stream) => stream.codec_type === 'audio');

  if (!audioStream) {
    throw new Error('Captured sample does not contain an audio stream');
  }

  const spectralMetadata = await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    samplePath,
    '-af',
    SPECTRAL_FILTER,
    '-f',
    'null',
    '-',
  ]);
  const spectralSummary = summariseSpectralMetadata(spectralMetadata.stdout);

  if (spectralSummary.frameCount === 0) {
    throw new Error('Captured sample did not emit enough spectral metadata for validation');
  }

  if (isLikelyMonotoneBuzz(spectralSummary)) {
    throw new Error(
      [
        'Captured sample looks like a steady tonal buzz rather than programme audio.',
        `entropy median=${formatMetric(spectralSummary.entropy.median)}`,
        `flatness median=${formatMetric(spectralSummary.flatness.median)}`,
        `centroid stdev=${formatMetric(spectralSummary.centroid.stdDev)}`,
        `crest median=${formatMetric(spectralSummary.crest.median)}`,
      ].join(' '),
    );
  }

  if (!options.quick) {
    await runCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      samplePath,
      '-lavfi',
      'showspectrumpic=s=1280x720:legend=disabled',
      '-frames:v',
      '1',
      '-update',
      '1',
      spectrogramPath,
    ]);
  }

  console.log(`Captured codec: ${audioStream.codec_name ?? '<unknown>'}`);
  console.log(
    `Spectral entropy median: ${formatMetric(spectralSummary.entropy.median)} (max ${formatMetric(
      spectralSummary.entropy.max,
    )})`,
  );
  console.log(
    `Spectral flatness median: ${formatMetric(
      spectralSummary.flatness.median,
    )} (max ${formatMetric(spectralSummary.flatness.max)})`,
  );
  console.log(
    `Spectral centroid stdev: ${formatMetric(
      spectralSummary.centroid.stdDev,
    )} Hz over ${spectralSummary.frameCount} frames`,
  );
  console.log(`Sample path: ${samplePath}`);
  if (options.quick) {
    console.log('Spectrogram skipped in quick mode');
  } else {
    console.log(`Spectrogram path: ${spectrogramPath}`);
  }
  console.log('Stream check passed');
}

function parseArgs(argv) {
  const args = new Set(argv);

  if (args.has('--help') || args.has('-h')) {
    console.log('Usage: node scripts/check-public-stream.mjs [--quick]');
    process.exit(0);
  }

  for (const arg of args) {
    if (arg !== '--quick') {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    quick: args.has('--quick'),
  };
}

function requestHeaders(urlString) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(
      target,
      {
        headers: {
          'Icy-MetaData': '1',
        },
        method: 'GET',
      },
      (response) => {
        const accessControlAllowOriginValues = [];
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          if (response.rawHeaders[index]?.toLowerCase() === 'access-control-allow-origin') {
            accessControlAllowOriginValues.push(response.rawHeaders[index + 1] ?? '');
          }
        }

        response.destroy();
        resolve({
          accessControlAllowOriginValues,
          headers: response.headers,
          statusCode: response.statusCode ?? 0,
          statusMessage: response.statusMessage ?? '',
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

function assertHeaderRequirements(response) {
  if (response.statusCode !== 200) {
    throw new Error(`Expected HTTP 200 from stream, received ${response.statusCode}`);
  }

  const contentType = response.headers['content-type'] ?? '';
  if (!String(contentType).includes('audio/mpeg')) {
    throw new Error(`Expected audio/mpeg content-type, received: ${contentType}`);
  }

  if (response.accessControlAllowOriginValues.length !== 1) {
    throw new Error(
      `Expected exactly one Access-Control-Allow-Origin header, received ${response.accessControlAllowOriginValues.length}`,
    );
  }
}

export function summariseSpectralMetadata(text) {
  const metrics = {
    centroid: [],
    crest: [],
    entropy: [],
    flatness: [],
  };

  const pattern = /lavfi\.aspectralstats\.1\.(centroid|crest|entropy|flatness)=([^\s]+)/g;
  for (const match of text.matchAll(pattern)) {
    const [, key, rawValue] = match;
    const value = Number.parseFloat(rawValue);
    if (!Number.isFinite(value)) {
      continue;
    }

    metrics[key].push(value);
  }

  return {
    centroid: summariseMetric(metrics.centroid),
    crest: summariseMetric(metrics.crest),
    entropy: summariseMetric(metrics.entropy),
    flatness: summariseMetric(metrics.flatness),
    frameCount: metrics.entropy.length,
  };
}

export function isLikelyMonotoneBuzz(summary) {
  return (
    summary.frameCount >= MONOTONE_THRESHOLDS.minFrames &&
    summary.entropy.median <= MONOTONE_THRESHOLDS.maxMedianEntropy &&
    summary.flatness.median <= MONOTONE_THRESHOLDS.maxMedianFlatness &&
    summary.centroid.stdDev <= MONOTONE_THRESHOLDS.maxCentroidStdDev &&
    summary.crest.median >= MONOTONE_THRESHOLDS.minMedianCrest
  );
}

function summariseMetric(values) {
  if (values.length === 0) {
    return {
      max: NaN,
      mean: NaN,
      median: NaN,
      min: NaN,
      stdDev: NaN,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / sorted.length;
  const median =
    sorted.length % 2 === 0
      ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
      : sorted[midpoint];

  return {
    max: sorted.at(-1) ?? NaN,
    mean,
    median,
    min: sorted[0] ?? NaN,
    stdDev: Math.sqrt(variance),
  };
}

function formatMetric(value) {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }

      reject(new Error(`${command} failed with exit code ${code}: ${stderr || stdout}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
