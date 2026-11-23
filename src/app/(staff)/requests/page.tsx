// SCR-04 Requests tab (/requests): the newest-first list with the weekly strip, a status filter and a search. Sign-in
// lands here. The page composes; the list is a client component under the staff layout. Filter and search are client
// state, not part of the address. Renders per request (never add `force-static` or `revalidate`).
import type { Metadata } from 'next';
import { RequestsList } from '@/components/staff/requests-list';

export const metadata: Metadata = { title: 'Requests' };

export default function RequestsPage() {
  return <RequestsList />;
}
