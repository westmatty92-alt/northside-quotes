// SCR-06 Request detail under the Pipeline tab (/pipeline/[request_id]): the same screen as under Requests, with the
// Pipeline tab marked and "Back to Pipeline".
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequestDetail } from '@/components/staff/request-detail';
import { isRequestIdParam } from '@/components/staff/request-id';

export const metadata: Metadata = { title: 'Request detail' };

export default async function RequestDetailFromPipelinePage({ params }: { params: Promise<{ request_id: string }> }) {
  const { request_id: requestId } = await params;
  if (!isRequestIdParam(requestId)) notFound();
  return <RequestDetail requestId={requestId} tab="pipeline" />;
}
