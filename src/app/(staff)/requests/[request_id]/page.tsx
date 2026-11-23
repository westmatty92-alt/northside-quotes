// SCR-06 Request detail under the Requests tab (/requests/[request_id]): the canonical address of a request, and where
// "Back to Requests" returns. The same screen is also served under /pipeline/[request_id].
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequestDetail } from '@/components/staff/request-detail';
import { isRequestIdParam } from '@/components/staff/request-id';

export const metadata: Metadata = { title: 'Request detail' };

export default async function RequestDetailFromRequestsPage({ params }: { params: Promise<{ request_id: string }> }) {
  const { request_id: requestId } = await params;
  if (!isRequestIdParam(requestId)) notFound();
  return <RequestDetail requestId={requestId} tab="requests" />;
}
