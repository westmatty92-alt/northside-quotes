// The signed-in screens' layout: the shared top bar and tab navigation (SCR-04, SCR-05, SCR-06), mounted once so the
// Requests tab's filter, search and scroll survive a visit to a request. A server component: it decides, per request,
// whether the screens run against the mock API (src/mocks/flag.ts) and hands the answer to the client shell.
// Every page under it renders per request (the root layout awaits `connection()`; never add `force-static` here).
import type { ReactNode } from 'react';
import { StaffShell } from '@/components/staff/staff-shell';
import { apiMockingEnabled } from '@/mocks/flag';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffShell mocking={apiMockingEnabled()}>{children}</StaffShell>;
}
