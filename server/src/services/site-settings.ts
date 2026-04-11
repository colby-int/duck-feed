import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { siteSettings } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export interface SiteAppearance {
  backgroundColor: string;
  containerColor: string;
  textColor: string;
  logoUrl: string;
  faviconUrl: string;
}

export interface SiteAssetUpload {
  kind: 'logo' | 'favicon';
  filename: string;
  contentType: string;
  body: Buffer;
}

export interface SiteAssetFile {
  buffer: Buffer;
  contentType: string;
}

const DEFAULT_SITE_APPEARANCE: SiteAppearance = {
  backgroundColor: '#E68E49',
  containerColor: '#2C398C',
  textColor: '#141413',
  logoUrl: '/logo.png',
  faviconUrl: '/favicon-32x32.png',
};

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico']);
const CONTENT_TYPE_TO_EXTENSION = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
  ['image/x-icon', '.ico'],
  ['image/vnd.microsoft.icon', '.ico'],
]);

function validateHexColor(value: string, label: string): string {
  const normalized = value.trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    throw new ValidationError(`${label} must be a 6-digit hex color`);
  }
  return normalized.toUpperCase();
}

function assetPathToUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) {
    return null;
  }
  return `/api/site-assets/${path.basename(assetPath)}`;
}

function inferAssetExtension(filename: string, contentType: string): string {
  const fromFilename = path.extname(filename).toLowerCase();
  if (ALLOWED_IMAGE_EXTENSIONS.has(fromFilename)) {
    return fromFilename;
  }

  const fromContentType = CONTENT_TYPE_TO_EXTENSION.get(contentType.toLowerCase());
  if (fromContentType) {
    return fromContentType;
  }

  throw new ValidationError('Unsupported image type');
}

function contentTypeFromAssetName(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

async function ensureBrandingDir(): Promise<void> {
  await fs.mkdir(config.BRANDING_DIR, { recursive: true });
}

async function getSiteSettingsRow() {
  const [row] = await db
    .select()
    .from(siteSettings)
    .orderBy(desc(siteSettings.createdAt))
    .limit(1);

  return row ?? null;
}

async function upsertSiteSettings(values: Partial<typeof siteSettings.$inferInsert>) {
  const existing = await getSiteSettingsRow();

  if (!existing) {
    const [created] = await db
      .insert(siteSettings)
      .values({
        ...values,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created;
  }

  const [updated] = await db
    .update(siteSettings)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(siteSettings.id, existing.id))
    .returning();

  return updated;
}

async function deleteBrandingAsset(assetPath: string | null | undefined): Promise<void> {
  if (!assetPath) {
    return;
  }

  const resolved = path.join(config.BRANDING_DIR, path.basename(assetPath));
  try {
    await fs.unlink(resolved);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function getResolvedSiteSettings(): Promise<SiteAppearance> {
  const row = await getSiteSettingsRow();
  return {
    backgroundColor: row?.backgroundColor ?? DEFAULT_SITE_APPEARANCE.backgroundColor,
    containerColor: row?.containerColor ?? DEFAULT_SITE_APPEARANCE.containerColor,
    textColor: row?.textColor ?? DEFAULT_SITE_APPEARANCE.textColor,
    logoUrl: assetPathToUrl(row?.logoAssetPath) ?? DEFAULT_SITE_APPEARANCE.logoUrl,
    faviconUrl: assetPathToUrl(row?.faviconAssetPath) ?? DEFAULT_SITE_APPEARANCE.faviconUrl,
  };
}

export async function updateSiteAppearanceColors(input: {
  backgroundColor: string;
  containerColor: string;
  textColor: string;
}): Promise<SiteAppearance> {
  await upsertSiteSettings({
    backgroundColor: validateHexColor(input.backgroundColor, 'Background color'),
    containerColor: validateHexColor(input.containerColor, 'Container color'),
    textColor: validateHexColor(input.textColor, 'Text color'),
  });

  return await getResolvedSiteSettings();
}

export async function replaceSiteAsset(upload: SiteAssetUpload): Promise<SiteAppearance> {
  const safeFilename = path.basename(upload.filename);
  if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
    throw new ValidationError('Invalid upload filename');
  }
  if (!Buffer.isBuffer(upload.body) || upload.body.length === 0) {
    throw new ValidationError('Upload body must be a non-empty binary payload');
  }
  if (!upload.contentType.toLowerCase().startsWith('image/')) {
    throw new ValidationError('Upload must be an image');
  }

  const extension = inferAssetExtension(safeFilename, upload.contentType);
  const assetBasename = `${upload.kind}-${randomBytes(8).toString('hex')}${extension}`;
  const assetPath = path.join(config.BRANDING_DIR, assetBasename);
  await ensureBrandingDir();
  await fs.writeFile(assetPath, upload.body);

  const existing = await getSiteSettingsRow();
  const previousAssetPath =
    upload.kind === 'logo' ? existing?.logoAssetPath ?? null : existing?.faviconAssetPath ?? null;

  await upsertSiteSettings(
    upload.kind === 'logo'
      ? {
          logoAssetPath: assetBasename,
        }
      : {
          faviconAssetPath: assetBasename,
        },
  );

  if (previousAssetPath && path.basename(previousAssetPath) !== assetBasename) {
    await deleteBrandingAsset(previousAssetPath);
  }

  return await getResolvedSiteSettings();
}

export async function readSiteAsset(filename: string): Promise<SiteAssetFile> {
  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
    throw new NotFoundError('Site asset');
  }

  const assetPath = path.join(config.BRANDING_DIR, safeFilename);
  try {
    return {
      buffer: await fs.readFile(assetPath),
      contentType: contentTypeFromAssetName(safeFilename),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new NotFoundError('Site asset');
    }
    throw error;
  }
}
