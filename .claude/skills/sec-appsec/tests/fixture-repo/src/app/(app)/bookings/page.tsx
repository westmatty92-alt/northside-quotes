// FIXTURE for .opengrep/baseleap.yml tests. Lines marked "expect:" must be flagged with that rule; all others must not.
import { adminClient } from '@/lib/server/admin'; // expect: baseleap-service-role-import-in-ui
import { formatDate } from '@/lib/shared/format';

export default function BookingsPage({ html, when }: { html: string; when: string }) {
  void adminClient;
  return (
    <section>
      <p>{formatDate(when)}</p>
      <div dangerouslySetInnerHTML={{ __html: html }} /> {/* expect: baseleap-dangerously-set-inner-html */}
    </section>
  );
}
