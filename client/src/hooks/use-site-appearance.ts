import { useContext } from 'react';
import { SiteAppearanceContext } from '../context/site-appearance-context';

export function useSiteAppearance() {
  const context = useContext(SiteAppearanceContext);
  if (!context) {
    throw new Error('useSiteAppearance must be used within a SiteAppearanceProvider');
  }
  return context;
}
