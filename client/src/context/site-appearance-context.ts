import { createContext } from 'react';
import type { SiteAppearance } from '../api/client';

export interface SiteAppearanceContextValue {
  appearance: SiteAppearance;
  loading: boolean;
  refresh: () => Promise<void>;
  setAppearance: (appearance: SiteAppearance) => void;
}

export const DEFAULT_SITE_APPEARANCE: SiteAppearance = {
  backgroundColor: '#E68E49',
  containerColor: '#2C398C',
  textColor: '#141413',
  logoUrl: '/logo.png',
  faviconUrl: '/favicon-32x32.png',
};

export const SiteAppearanceContext = createContext<SiteAppearanceContextValue | null>(null);
