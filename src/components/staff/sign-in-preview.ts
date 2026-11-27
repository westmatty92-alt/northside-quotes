// The one seam between the sign-in form and the mock layer, like the request form's `FormPreviewContext`. In a normal
// run nothing provides this context and the form starts blank. With API mocking on, `src/mocks/**` provides a seed for
// the named scenario (`?mockScenario=` is read there and only there): what to type, and whether to press "Sign in"
// once on load, so a refusal is reachable without a click.
import { createContext } from 'react';

export interface SignInPreview {
  email: string;
  password: string;
  autoSubmit: boolean;
}

export const SignInPreviewContext = createContext<SignInPreview | undefined>(undefined);
