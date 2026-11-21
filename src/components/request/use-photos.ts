// The photo list on SCR-01: what was picked, what was refused and why, and how far each upload got.
//
// A file is checked the moment it is picked: its real type from its first bytes (a PDF, or a text file renamed
// to .jpg, is refused), then its size. Refused files stay in the list with their reason beside them, so she sees
// what was refused; they are never sent and never count toward the 3. The server checks the bytes again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { copy } from '@/components/request/copy';
import type { PhotoPlanContentType } from '@/lib/api/generated/model';

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5_242_880;

export type PhotoStatus = 'ready' | 'uploading' | 'uploaded' | 'failed';

export interface PhotoItem {
  id: number;
  file: File;
  /** The type its first bytes show, or null when it is none of the three allowed ones. */
  contentType: PhotoPlanContentType | null;
  /** A temporary address for the thumbnail (accepted photos only); revoked when the photo is removed. */
  previewUrl: string | null;
  status: PhotoStatus;
  /** A reason shown beside the photo. `blocking` means it must be removed before sending (it can never be sent). */
  problem: { text: string; blocking: boolean } | null;
}

let nextId = 1;

function readHead(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

/** JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP` (the same signatures the server checks). */
export async function sniffPhotoType(file: File): Promise<PhotoPlanContentType | null> {
  const bytes = await readHead(file).catch(() => new Uint8Array(0));
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export function formatSize(bytes: number): string {
  return bytes < 102_400 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export const isAccepted = (item: PhotoItem) => !item.problem?.blocking;

function makePreviewUrl(file: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

function revokePreviewUrl(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

export function usePhotos() {
  const [items, setItems] = useState<readonly PhotoItem[]>([]);
  // The newest list, for handlers that run between renders (the submit flow reads it, never render).
  const latest = useRef<readonly PhotoItem[]>([]);

  const commit = useCallback((update: (current: readonly PhotoItem[]) => readonly PhotoItem[]) => {
    latest.current = update(latest.current);
    setItems(latest.current);
  }, []);

  const addFiles = useCallback(
    async (files: readonly File[]) => {
      const checked = await Promise.all(
        files.map(async (file): Promise<PhotoItem> => {
          const contentType = await sniffPhotoType(file);
          const problem = !contentType
            ? { text: copy.photos.wrongType, blocking: true }
            : file.size > MAX_PHOTO_BYTES
              ? { text: copy.photos.tooBig, blocking: true }
              : null;
          return { id: nextId++, file, contentType, previewUrl: null, status: 'ready', problem };
        }),
      );
      commit((current) => {
        let room = MAX_PHOTOS - current.filter(isAccepted).length;
        const added: PhotoItem[] = [];
        for (const item of checked) {
          if (item.problem) added.push(item);
          else if (room > 0) {
            added.push({ ...item, previewUrl: makePreviewUrl(item.file) });
            room -= 1;
          }
          // a 4th good photo is simply not added: the message beside the paused button says why
        }
        return [...current, ...added];
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: number) =>
      commit((current) => {
        for (const item of current) if (item.id === id) revokePreviewUrl(item.previewUrl);
        return current.filter((item) => item.id !== id);
      }),
    [commit],
  );

  // thumbnails are temporary addresses: let go of them all when the form goes away
  useEffect(
    () => () => {
      for (const item of latest.current) revokePreviewUrl(item.previewUrl);
    },
    [],
  );

  const update = useCallback(
    (id: number, patch: Partial<Pick<PhotoItem, 'status' | 'problem'>>) =>
      commit((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item))),
    [commit],
  );

  const getItems = useCallback(() => latest.current, []);

  const accepted = items.filter(isAccepted);
  return {
    items,
    acceptedCount: accepted.length,
    refusedCount: items.length - accepted.length,
    atLimit: accepted.length >= MAX_PHOTOS,
    addFiles,
    remove,
    update,
    getItems,
  };
}
