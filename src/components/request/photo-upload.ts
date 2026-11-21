// One photo straight to the private `quote-photos` bucket with supabase-js (operation uploadQuotePhoto): the
// publishable key and no staff session, into the path createQuoteRequest returned, never overwriting.
// An object that already exists (a retry after a lost reply) comes back as 409; that photo is already uploaded.
import { getUploadClient } from '@/lib/supabase/browser';
import type { PhotoUpload } from '@/lib/api/generated/model';
import type { UploadablePhoto } from '@/components/request/submit-flow';

export function isAlreadyUploaded(error: { message: string; statusCode?: string; status?: number }): boolean {
  return error.statusCode === '409' || error.status === 409 || /already exists|duplicate/i.test(error.message);
}

export async function uploadPhoto(target: PhotoUpload, photo: UploadablePhoto): Promise<void> {
  const { error } = await getUploadClient()
    .storage.from(target.bucket)
    .upload(target.path, photo.file, { contentType: photo.contentType, upsert: false });
  if (error && !isAlreadyUploaded(error)) throw error;
}
