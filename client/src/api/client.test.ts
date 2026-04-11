import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type UploadEpisodeWithProgress = (
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
) => Promise<{ filename: string; path: string }>;

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];

  readonly upload = {
    onprogress: null as ((event: ProgressEvent<XMLHttpRequestEventTarget>) => void) | null,
  };

  aborted = false;
  method = '';
  onabort: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null;
  onerror: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null;
  onload: ((this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => unknown) | null = null;
  responseText = '';
  sentBody: Document | XMLHttpRequestBodyInit | null = null;
  status = 0;
  url = '';
  withCredentials = false;
  headers = new Map<string, string>();

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.sentBody = body ?? null;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.call(this as unknown as XMLHttpRequest, new ProgressEvent('abort'));
  }

  dispatchLoad(): void {
    this.onload?.call(this as unknown as XMLHttpRequest, new ProgressEvent('load'));
  }

  dispatchError(): void {
    this.onerror?.call(this as unknown as XMLHttpRequest, new ProgressEvent('error'));
  }

  dispatchProgress(loaded: number, total: number): void {
    this.upload.onprogress?.(
      {
        lengthComputable: true,
        loaded,
        total,
      } as ProgressEvent<XMLHttpRequestEventTarget>,
    );
  }
}

async function getUploadEpisodeWithProgress(): Promise<UploadEpisodeWithProgress> {
  const clientModule = (await import('./client')) as {
    uploadEpisodeWithProgress?: UploadEpisodeWithProgress;
  };

  if (!clientModule.uploadEpisodeWithProgress) {
    throw new Error('uploadEpisodeWithProgress is not implemented');
  }

  return clientModule.uploadEpisodeWithProgress;
}

describe('uploadEpisodeWithProgress', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest as unknown as typeof XMLHttpRequest);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads audio with credentials, reports progress, and resolves envelope data', async () => {
    const uploadEpisodeWithProgress = await getUploadEpisodeWithProgress();
    const file = new File(['audio'], 'episode.wav', { type: 'audio/wav' });
    const onProgress = vi.fn();

    const uploadPromise = uploadEpisodeWithProgress(file, onProgress);
    const xhr = FakeXMLHttpRequest.instances[0];

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/admin/ingest/upload');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.get('Content-Type')).toBe('audio/wav');
    expect(xhr.headers.get('x-filename')).toBe('episode.wav');
    expect(xhr.sentBody).toBe(file);

    xhr.dispatchProgress(128, 256);
    expect(onProgress).toHaveBeenCalledWith(0.5);

    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      data: {
        filename: 'episode.wav',
        path: '/dropzone/episode.wav',
      },
      error: null,
      meta: null,
    });
    xhr.dispatchLoad();

    await expect(uploadPromise).resolves.toEqual({
      filename: 'episode.wav',
      path: '/dropzone/episode.wav',
    });
  });

  it('rejects with the server envelope error message', async () => {
    const uploadEpisodeWithProgress = await getUploadEpisodeWithProgress();
    const file = new File(['audio'], 'duplicate.wav', { type: 'audio/wav' });

    const uploadPromise = uploadEpisodeWithProgress(file, vi.fn());
    const xhr = FakeXMLHttpRequest.instances[0];

    xhr.status = 409;
    xhr.responseText = JSON.stringify({
      data: null,
      error: {
        code: 'conflict',
        message: 'file already exists',
      },
      meta: null,
    });
    xhr.dispatchLoad();

    await expect(uploadPromise).rejects.toThrow('file already exists');
  });

  it('aborts the request when the signal is cancelled', async () => {
    const uploadEpisodeWithProgress = await getUploadEpisodeWithProgress();
    const file = new File(['audio'], 'cancel.wav', { type: 'audio/wav' });
    const controller = new AbortController();

    const uploadPromise = uploadEpisodeWithProgress(file, vi.fn(), controller.signal);
    const xhr = FakeXMLHttpRequest.instances[0];

    controller.abort();

    await expect(uploadPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr.aborted).toBe(true);
  });
});
