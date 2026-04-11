import { useEffect, useState } from 'react';
import { getSiteAppearance, type SiteAppearance } from '../api/client';
import {
  DEFAULT_SITE_APPEARANCE,
  SiteAppearanceContext,
  type SiteAppearanceContextValue,
} from './site-appearance-context';

function normalizeHexChannels(hexColor: string, fallback: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hexColor.trim());
  if (!match) {
    return fallback;
  }

  const hex = match[1];
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return channels.join(' ');
}

function parseHexColor(hexColor: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hexColor.trim());
  if (!match) {
    return null;
  }

  const hex = match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const normalize = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  const r = normalize(red);
  const g = normalize(green);
  const b = normalize(blue);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function getBrandTextChannels(appearance: SiteAppearance): string {
  const background = parseHexColor(appearance.backgroundColor);
  const text = parseHexColor(appearance.textColor);
  if (!background || !text) {
    return '20 20 19';
  }

  return contrastRatio(text, background) >= 4.5 ? text.join(' ') : '248 244 232';
}

function updateHeadLinks(rel: string, href: string): void {
  const existingLinks = [...document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)];
  if (existingLinks.length === 0) {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    document.head.appendChild(link);
    return;
  }

  existingLinks.forEach((link) => {
    link.href = href;
  });
}

function applyAppearanceToDocument(appearance: SiteAppearance): void {
  document.documentElement.style.setProperty(
    '--site-color-brand',
    normalizeHexChannels(appearance.backgroundColor, '230 142 73'),
  );
  document.documentElement.style.setProperty(
    '--site-color-container',
    normalizeHexChannels(appearance.containerColor, '44 57 140'),
  );
  document.documentElement.style.setProperty(
    '--site-color-text',
    normalizeHexChannels(appearance.textColor, '20 20 19'),
  );
  document.documentElement.style.setProperty('--site-color-brand-text', getBrandTextChannels(appearance));

  updateHeadLinks('icon', appearance.faviconUrl);
  updateHeadLinks('apple-touch-icon', appearance.faviconUrl);
}

export function SiteAppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<SiteAppearance>(DEFAULT_SITE_APPEARANCE);
  const [loading, setLoading] = useState(true);

  async function refresh(): Promise<void> {
    try {
      const nextAppearance = await getSiteAppearance();
      setAppearanceState(nextAppearance);
    } catch {
      setAppearanceState(DEFAULT_SITE_APPEARANCE);
    } finally {
      setLoading(false);
    }
  }

  function setAppearance(nextAppearance: SiteAppearance): void {
    setAppearanceState(nextAppearance);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    applyAppearanceToDocument(appearance);
  }, [appearance]);

  const value: SiteAppearanceContextValue = {
    appearance,
    loading,
    refresh,
    setAppearance,
  };

  return <SiteAppearanceContext.Provider value={value}>{children}</SiteAppearanceContext.Provider>;
}
