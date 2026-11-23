// The one seam between the form and the mock layer. In a normal run nothing provides this context, so the form
// starts blank. When API mocking is on, `src/mocks/**` provides a seed for a named scenario (`?mockScenario=` is
// read there and only there): some typed values, some picked files, and whether to press Send once on load. The
// form then does exactly what it does for a person: validates, calls the API, shows what comes back.
import { createContext } from 'react';
import type { FormValues } from '@/components/request/form-values';

export interface FormPreview {
  values: Partial<FormValues>;
  files: readonly File[];
  /** Press Send once on load, so a failure or refusal state is reachable without a click. */
  autoSend: boolean;
}

export const FormPreviewContext = createContext<FormPreview | undefined>(undefined);
