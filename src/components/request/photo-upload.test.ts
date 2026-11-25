// uploadPhoto: when a storage 409 counts as "already uploaded" and when it is a conflict (REV-2 / CQ-4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { photoIdentity, uploadPhoto } from '@/components/request/photo-upload';
import { PhotoConflict, type UploadablePhoto } from '@/components/request/submit-flow';
import type { PhotoUpload } from '@/lib/api/generated/model';

type Answer = { message: string; statusCode?: string } | null;
const storage = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({
  getUploadClient: () => ({ storage: { from: () => ({ upload: storage.upload }) } }),
}));

const EXISTS: Answer = { message: 'The resource already exists', statusCode: '409' };
const LOST: Answer = { message: 'Failed to fetch' };

let counter = 0;
/** A target no other test has used: the uploader remembers per path, for the life of the tab. */
const freshTarget = (): PhotoUpload => ({
  position: 1,
  bucket: 'quote-photos',
  path: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}/photo-1`,
  content_type: 'image/jpeg',
});

const photo = (name: string, size = 2048, lastModified = 1_700_000_000_000): UploadablePhoto => ({
  position: 1,
  file: new File([new Uint8Array(size)], name, { type: 'image/jpeg', lastModified }),
  contentType: 'image/jpeg',
  alreadyUploaded: false,
});

/** The storage answers, in order, for the next calls. */
const answers = (...list: Answer[]) => {
  for (const error of list) storage.upload.mockResolvedValueOnce({ data: error ? null : { path: 'x' }, error });
};

beforeEach(() => storage.upload.mockReset());

describe('photoIdentity', () => {
  it('tells files apart by name, size and last-modified time', () => {
    const base = photoIdentity(photo('a.jpg').file);
    expect(photoIdentity(photo('a.jpg').file)).toBe(base);
    expect(photoIdentity(photo('b.jpg').file)).not.toBe(base);
    expect(photoIdentity(photo('a.jpg', 4096).file)).not.toBe(base);
    expect(photoIdentity(photo('a.jpg', 2048, 1_700_000_999_000).file)).not.toBe(base);
  });
});

describe('uploadPhoto and a storage 409', () => {
  it('uploads to the path it was given without overwriting', async () => {
    const target = freshTarget();
    const x = photo('x.jpg');
    answers(null);
    await uploadPhoto(target, x);
    expect(storage.upload).toHaveBeenCalledWith(target.path, x.file, { contentType: 'image/jpeg', upsert: false });
  });

  it('a 409 for the same file this tab uploaded there is "already uploaded"', async () => {
    const target = freshTarget();
    const x = photo('x.jpg');
    answers(null, EXISTS);
    await uploadPhoto(target, x);
    await expect(uploadPhoto(target, x)).resolves.toBeUndefined();
  });

  it('the same file again (same name, size, last-modified) counts as the same file', async () => {
    const target = freshTarget();
    answers(null, EXISTS);
    await uploadPhoto(target, photo('x.jpg'));
    await expect(uploadPhoto(target, photo('x.jpg'))).resolves.toBeUndefined();
  });

  it('a 409 after a lost reply for the same file is "already uploaded"', async () => {
    const target = freshTarget();
    const x = photo('x.jpg');
    answers(LOST, EXISTS);
    await expect(uploadPhoto(target, x)).rejects.toMatchObject({ message: 'Failed to fetch' });
    await expect(uploadPhoto(target, x)).resolves.toBeUndefined();
  });

  it('a different photo with the same type and size at the same path is a conflict', async () => {
    const target = freshTarget();
    answers(null, EXISTS);
    await uploadPhoto(target, photo('x.jpg'));
    await expect(uploadPhoto(target, photo('y.jpg'))).rejects.toBeInstanceOf(PhotoConflict);
  });

  it('the same name and size with another last-modified time is a conflict', async () => {
    const target = freshTarget();
    answers(null, EXISTS);
    await uploadPhoto(target, photo('IMG_0001.jpg', 2048, 1_700_000_000_000));
    await expect(uploadPhoto(target, photo('IMG_0001.jpg', 2048, 1_700_000_500_000))).rejects.toBeInstanceOf(PhotoConflict);
  });

  it('a 409 for a path this tab never sent anything to is a conflict', async () => {
    const target = freshTarget();
    answers(EXISTS);
    const failure = await uploadPhoto(target, photo('x.jpg')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PhotoConflict);
    expect(failure).toMatchObject({ positions: [1] });
  });

  it('after a lost reply, a different photo getting a 409 is a conflict (either file may be the one stored)', async () => {
    const target = freshTarget();
    answers(LOST, EXISTS);
    await expect(uploadPhoto(target, photo('x.jpg'))).rejects.toThrow();
    await expect(uploadPhoto(target, photo('y.jpg'))).rejects.toBeInstanceOf(PhotoConflict);
  });

  it('a conflict stays a conflict when the swapped photo is tried again', async () => {
    const target = freshTarget();
    answers(null, EXISTS, EXISTS);
    await uploadPhoto(target, photo('x.jpg'));
    await expect(uploadPhoto(target, photo('y.jpg'))).rejects.toBeInstanceOf(PhotoConflict);
    await expect(uploadPhoto(target, photo('y.jpg'))).rejects.toBeInstanceOf(PhotoConflict);
  });

  it('a photo that really landed after an earlier lost reply is that file from then on', async () => {
    const target = freshTarget();
    answers(LOST, null, EXISTS);
    await expect(uploadPhoto(target, photo('x.jpg'))).rejects.toThrow(); // never stored
    await uploadPhoto(target, photo('y.jpg')); // stored: the path is exactly Y now
    await expect(uploadPhoto(target, photo('y.jpg'))).resolves.toBeUndefined();
  });

  it('an error that is not a 409 is thrown as it is', async () => {
    const target = freshTarget();
    answers({ message: 'new row violates row-level security policy', statusCode: '403' });
    await expect(uploadPhoto(target, photo('x.jpg'))).rejects.toMatchObject({ statusCode: '403' });
  });
});
