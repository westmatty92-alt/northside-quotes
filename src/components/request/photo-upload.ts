// One photo straight to the private `quote-photos` bucket with supabase-js (operation uploadQuotePhoto): the
// publishable key and no staff session, into the path createQuoteRequest returned, never overwriting.
//
// An object that already exists comes back as 409. That means "already uploaded" in exactly one case: a retry after
// a lost reply, where the object at that path is the very file this tab sent there. Any other 409 (a different photo
// was swapped in after a failed send, or this tab never sent anything to that path) means the stored photo is not
// the one she has now, so it throws `PhotoConflict` and the send restarts under a fresh form token.
//
// What this tab has sent is kept per path. A path carries the request id, and a request belongs to one form token,
// so the record is per token as well; it lives in memory only and is gone when the tab closes.
import { getUploadClient } from '@/lib/supabase/browser';
import type { PhotoUpload } from '@/lib/api/generated/model';
import { PhotoConflict, type UploadablePhoto } from '@/components/request/submit-flow';

/** True for storage's "that object already exists" answer. It says nothing about whose file is there. */
export function isAlreadyUploaded(error: { message: string; statusCode?: string; status?: number }): boolean {
  return error.statusCode === '409' || error.status === 409 || /already exists|duplicate/i.test(error.message);
}

/** Who a file is, as far as this tab can tell: name, size and last-modified time (a different photo differs in one). */
export function photoIdentity(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

// path -> identities of the files this tab sent to it that may be in Storage (an attempt whose reply was lost may
// have landed). A success makes it exactly that file, because `upsert: false` only succeeds on an empty path.
const sentTo = new Map<string, ReadonlySet<string>>();

export async function uploadPhoto(target: PhotoUpload, photo: UploadablePhoto): Promise<void> {
  const identity = photoIdentity(photo.file);
  const before = sentTo.get(target.path) ?? new Set<string>();
  sentTo.set(target.path, new Set([...before, identity]));

  const { error } = await getUploadClient()
    .storage.from(target.bucket)
    .upload(target.path, photo.file, { contentType: photo.contentType, upsert: false });

  if (!error) {
    sentTo.set(target.path, new Set([identity]));
    return;
  }
  if (!isAlreadyUploaded(error)) throw error;

  // Something is stored there. It is hers only if this file is the one and only thing this tab ever sent to that path.
  if (before.size === 1 && before.has(identity)) return;
  throw new PhotoConflict([photo.position]);
}
