'use client';

// PhotoPicker (component map): a native file input behind an "Add a photo" button, and one row per photo with a
// thumbnail, file name, size and a Remove button that names the file. Up to 3; the button pauses at 3 with the words
// beside it. A refused or failed photo shows its reason beside it, with an icon and words.
import { useRef, useState, type ChangeEvent } from 'react';
import { copy } from '@/components/request/copy';
import { formatSize, isAccepted, type PhotoItem } from '@/components/request/use-photos';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

interface PhotoPickerProps {
  items: readonly PhotoItem[];
  atLimit: boolean;
  sending: boolean;
  onAdd: (files: readonly File[]) => void;
  onRemove: (id: number) => void;
}

function Thumb({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm bg-neutral-surface text-text-secondary">
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local preview of a file she picked, never a remote image
        <img src={url} alt="" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon name="image" />
      )}
    </span>
  );
}

export function PhotoPicker({ items, atLimit, sending, onAdd, onRemove }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const accepted = items.filter(isAccepted);

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    // clear the input so choosing the same file again still counts as a change
    event.currentTarget.value = '';
    if (files.length > 0) onAdd(files);
  }

  return (
    <fieldset id="photos" tabIndex={-1} className="grid min-w-0 gap-md">
      <legend className="mb-sm p-0">
        <h2 className={type.h2}>
          {copy.groups.photos} <span className={cn(type.regular, 'text-text-secondary')}>{copy.optional}</span>
        </h2>
      </legend>
      <p className={type.hint}>{copy.hints.photos}</p>

      {items.length > 0 ? (
        <ul aria-label={copy.photos.list} className="grid gap-sm">
          {items.map((item) => {
            const position = accepted.findIndex((candidate) => candidate.id === item.id) + 1;
            const note =
              item.status === 'uploading'
                ? copy.photos.uploading(position, accepted.length)
                : item.status === 'uploaded'
                  ? `${formatSize(item.file.size)}, ${copy.photos.uploaded}`
                  : formatSize(item.file.size);
            return (
              <li
                key={item.id}
                className={cn(
                  'flex flex-wrap items-center gap-md rounded-md border border-border-strong bg-surface p-sm',
                  item.problem && 'border-2 border-danger bg-danger-surface',
                )}
              >
                <Thumb url={item.previewUrl} />
                <div className="min-w-0 flex-1">
                  <p className={cn(type.label, 'leading-snug')}>{item.file.name}</p>
                  <p className={type.hint}>{note}</p>
                </div>
                <Button
                  aria-label={copy.photos.removeLabel(item.file.name)}
                  paused={sending}
                  onClick={() => onRemove(item.id)}
                >
                  Remove
                </Button>
                {item.problem ? <FieldError className="basis-full">{item.problem.text}</FieldError> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="grid justify-items-start gap-md">
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png,image/webp"
          data-testid="photo-input"
          onChange={picked}
        />
        <Button
          paused={atLimit || sending}
          aria-describedby={atLimit ? 'photos-limit' : undefined}
          onClick={() => input.current?.click()}
        >
          <Icon name="camera" />
          {copy.photos.add}
        </Button>
        {atLimit ? <FieldError id="photos-limit">{copy.photos.limit}</FieldError> : null}
      </div>
    </fieldset>
  );
}
