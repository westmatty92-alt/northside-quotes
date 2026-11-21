// What every public page sits in: the chrome (header, one main landmark, footer) and the client providers.
// Server component. Pages that use it render per request (they call `connection()` first), see page.tsx.
import type { ReactNode } from 'react';
import { AppProviders } from '@/components/ui/app-providers';
import { SiteChrome } from '@/components/ui/site/site-chrome';
import { apiMockingEnabled } from '@/mocks/flag';

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <SiteChrome>
      <AppProviders mocking={apiMockingEnabled()}>{children}</AppProviders>
    </SiteChrome>
  );
}
