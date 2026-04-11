import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngestPage } from './IngestPage';

const { requestDataMock, uploadEpisodeWithProgressMock } = vi.hoisted(() => ({
  requestDataMock: vi.fn(),
  uploadEpisodeWithProgressMock: vi.fn(),
}));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    requestData: requestDataMock,
    uploadEpisodeWithProgress: uploadEpisodeWithProgressMock,
  };
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }

  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

describe('IngestPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    requestDataMock.mockReset();
    uploadEpisodeWithProgressMock.mockReset();

    requestDataMock.mockResolvedValue([]);
  });

  it('uploads queued files sequentially, keeps going after errors, and clears finished entries', async () => {
    const firstUpload = createDeferred<{ filename: string; path: string }>();
    const thirdUpload = createDeferred<{ filename: string; path: string }>();
    let reportFirstProgress!: (fraction: number) => void;
    let reportThirdProgress!: (fraction: number) => void;

    uploadEpisodeWithProgressMock.mockImplementation((file: File, onProgress: (fraction: number) => void) => {
      if (file.name === 'first.wav') {
        reportFirstProgress = onProgress;
        return firstUpload.promise;
      }

      if (file.name === 'second.wav') {
        onProgress(0.25);
        return Promise.reject(new Error('file already exists'));
      }

      if (file.name === 'third.wav') {
        reportThirdProgress = onProgress;
        return thirdUpload.promise;
      }

      throw new Error(`Unexpected file ${file.name}`);
    });

    render(<IngestPage />);
    const [fileInput] = screen.getAllByLabelText(/choose audio files/i);

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['first'], 'first.wav', { type: 'audio/wav' }),
          new File(['second'], 'second.wav', { type: 'audio/wav' }),
          new File(['third'], 'third.wav', { type: 'audio/wav' }),
        ],
      },
    });

    await waitFor(() => {
      expect(uploadEpisodeWithProgressMock).toHaveBeenCalledTimes(1);
    });

    reportFirstProgress(0.5);
    expect(await screen.findByText('50%')).toBeInTheDocument();

    firstUpload.resolve({ filename: 'first.wav', path: '/dropzone/first.wav' });

    await waitFor(() => {
      expect(uploadEpisodeWithProgressMock).toHaveBeenCalledTimes(3);
    });
    expect(uploadEpisodeWithProgressMock.mock.calls[1]?.[0].name).toBe('second.wav');
    expect(uploadEpisodeWithProgressMock.mock.calls[2]?.[0].name).toBe('third.wav');

    await waitFor(() => {
      expect(screen.getByText(/file already exists/i)).toBeInTheDocument();
    });

    reportThirdProgress(1);
    thirdUpload.resolve({ filename: 'third.wav', path: '/dropzone/third.wav' });

    await waitFor(() => {
      expect(screen.getAllByText(/uploaded/i)).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole('button', { name: /clear finished/i }));

    await waitFor(() => {
      expect(screen.queryByText('first.wav')).not.toBeInTheDocument();
      expect(screen.queryByText('second.wav')).not.toBeInTheDocument();
      expect(screen.queryByText('third.wav')).not.toBeInTheDocument();
    });
  });

  it('removes an aborted upload and starts the next pending file', async () => {
    const secondUpload = createDeferred<{ filename: string; path: string }>();

    uploadEpisodeWithProgressMock.mockImplementation(
      (file: File, _onProgress: (fraction: number) => void, signal?: AbortSignal) => {
        if (file.name === 'first.wav') {
          return new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                reject(createAbortError());
              },
              { once: true },
            );
          });
        }

        if (file.name === 'second.wav') {
          return secondUpload.promise;
        }

        throw new Error(`Unexpected file ${file.name}`);
      },
    );

    render(<IngestPage />);
    const [fileInput] = screen.getAllByLabelText(/choose audio files/i);

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['first'], 'first.wav', { type: 'audio/wav' }),
          new File(['second'], 'second.wav', { type: 'audio/wav' }),
        ],
      },
    });

    await waitFor(() => {
      expect(uploadEpisodeWithProgressMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel first\.wav/i }));

    await waitFor(() => {
      expect(screen.queryByText('first.wav')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(uploadEpisodeWithProgressMock).toHaveBeenCalledTimes(2);
    });

    secondUpload.resolve({ filename: 'second.wav', path: '/dropzone/second.wav' });

    await waitFor(() => {
      expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
    });
  });

  it('queues only audio files dropped onto the drop zone', async () => {
    uploadEpisodeWithProgressMock.mockResolvedValue({
      filename: 'dropped.wav',
      path: '/dropzone/dropped.wav',
    });

    render(<IngestPage />);
    const [dropZone] = screen.getAllByLabelText(/drop audio files here/i);

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [
          new File(['audio'], 'dropped.wav', { type: 'audio/wav' }),
          new File(['notes'], 'notes.txt', { type: 'text/plain' }),
        ],
      },
    });

    await waitFor(() => {
      expect(uploadEpisodeWithProgressMock).toHaveBeenCalledTimes(1);
    });

    const [queuedFile] = uploadEpisodeWithProgressMock.mock.calls[0];
    expect(queuedFile.name).toBe('dropped.wav');
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});
