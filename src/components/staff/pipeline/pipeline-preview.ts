// The one seam between the board and the mock layer, like the sign-in form's `SignInPreviewContext`. In a normal run
// nothing provides this context and the board does nothing on its own. With API mocking on, `src/mocks/**` provides a
// seed for the named scenario (`?mockScenario=` is read there and only there): one move to make once the board has
// loaded, so a saving, refused or conflicting move is reachable without a click or a drag.
import { createContext } from 'react';
import type { Status } from '@/lib/api/generated/model';

export interface PipelinePreview {
  /** The card to move, by its reference number. */
  reference: string;
  to: Status;
}

export const PipelinePreviewContext = createContext<PipelinePreview | undefined>(undefined);
