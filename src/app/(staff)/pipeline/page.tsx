// SCR-05 Pipeline tab (/pipeline): every request in four fixed columns (New, Quoted, Won, Lost), with the weekly strip
// above. Its own address, never filtered, no search, no List / Board switch. The page composes; the board is a client
// component under the staff layout, which supplies the one `main` landmark. Renders per request (never add
// `force-static` or `revalidate`).
import type { Metadata } from 'next';
import { PipelineBoard } from '@/components/staff/pipeline/pipeline-board';

export const metadata: Metadata = { title: 'Pipeline' };

export default function PipelinePage() {
  return <PipelineBoard />;
}
