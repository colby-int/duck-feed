import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import { updateSiteAppearance, uploadSiteFavicon, uploadSiteLogo } from '../api/client';
import { Panel } from '../components/Panel';
import { useSiteAppearance } from '../hooks/use-site-appearance';

export function AppearancePage() {
  const { appearance, setAppearance } = useSiteAppearance();
  const [backgroundColor, setBackgroundColor] = useState(appearance.backgroundColor);
  const [containerColor, setContainerColor] = useState(appearance.containerColor);
  const [textColor, setTextColor] = useState(appearance.textColor);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);

  useEffect(() => {
    setBackgroundColor(appearance.backgroundColor);
    setContainerColor(appearance.containerColor);
    setTextColor(appearance.textColor);
  }, [appearance]);

  async function saveAppearance(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const nextAppearance = await updateSiteAppearance({
        backgroundColor,
        containerColor,
        textColor,
      });
      setAppearance(nextAppearance);
      setMessage('Appearance saved');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save appearance');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(): Promise<void> {
    if (!logoFile) return;
    setUploadingLogo(true);
    setError(null);
    setMessage(null);
    try {
      const nextAppearance = await uploadSiteLogo(logoFile);
      setAppearance(nextAppearance);
      setLogoFile(null);
      setMessage('Logo updated');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleFaviconUpload(): Promise<void> {
    if (!faviconFile) return;
    setUploadingFavicon(true);
    setError(null);
    setMessage(null);
    try {
      const nextAppearance = await uploadSiteFavicon(faviconFile);
      setAppearance(nextAppearance);
      setFaviconFile(null);
      setMessage('Favicon updated');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload favicon');
    } finally {
      setUploadingFavicon(false);
    }
  }

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setLogoFile(event.target.files?.[0] ?? null);
  }

  function handleFaviconFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFaviconFile(event.target.files?.[0] ?? null);
  }

  return (
    <div className="space-y-6">
      <Panel title="Appearance" subtitle="branding">
        <form className="space-y-6" onSubmit={(event) => void saveAppearance(event)}>
          <div className="grid gap-5 lg:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Background color</span>
              <input
                aria-label="Background color"
                className="h-12 w-full cursor-pointer bg-white p-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                onChange={(event) => setBackgroundColor(event.target.value)}
                type="color"
                value={backgroundColor}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Container color</span>
              <input
                aria-label="Container color"
                className="h-12 w-full cursor-pointer bg-white p-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                onChange={(event) => setContainerColor(event.target.value)}
                type="color"
                value={containerColor}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Text color</span>
              <input
                aria-label="Text color"
                className="h-12 w-full cursor-pointer bg-white p-2 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"
                onChange={(event) => setTextColor(event.target.value)}
                type="color"
                value={textColor}
              />
            </label>
          </div>

          <button
            className="bg-butter px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-ink"
            disabled={saving}
            type="submit"
          >
            {saving ? 'Saving…' : 'Save appearance'}
          </button>
        </form>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Logo</div>
            <div className="bg-white p-4 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
              <img alt="Current site logo" className="w-full max-w-[220px]" src={appearance.logoUrl} />
            </div>
            <label className="block">
              <span className="mb-2 block text-sm text-ink/70">Logo file</span>
              <input aria-label="Logo file" className="block w-full text-sm text-ink/80" onChange={handleLogoFileChange} type="file" />
            </label>
            <button
              className="bg-panel px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
              disabled={!logoFile || uploadingLogo}
              onClick={() => void handleLogoUpload()}
              type="button"
            >
              {uploadingLogo ? 'Uploading…' : 'Upload logo'}
            </button>
          </div>

          <div className="space-y-4">
            <div className="text-[0.68rem] uppercase tracking-[0.24em] text-ink/60">Favicon</div>
            <div className="bg-white p-4 shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
              <div className="flex h-16 w-16 items-center justify-center bg-parchment shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
                <img alt="Current favicon" className="h-10 w-10 object-contain" src={appearance.faviconUrl} />
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm text-ink/70">Favicon file</span>
              <input
                aria-label="Favicon file"
                className="block w-full text-sm text-ink/80"
                onChange={handleFaviconFileChange}
                type="file"
              />
            </label>
            <button
              className="bg-panel px-5 py-3 text-sm font-medium uppercase tracking-[0.18em] text-white"
              disabled={!faviconFile || uploadingFavicon}
              onClick={() => void handleFaviconUpload()}
              type="button"
            >
              {uploadingFavicon ? 'Uploading…' : 'Upload favicon'}
            </button>
          </div>
        </div>

        {message ? <p className="mt-6 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </Panel>
    </div>
  );
}
