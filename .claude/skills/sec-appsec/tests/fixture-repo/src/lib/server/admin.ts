import 'server-only';
// FIXTURE. The one file allowed to read the service-role key: nothing here may be flagged.
import { createClient } from '@supabase/supabase-js';

export const adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
