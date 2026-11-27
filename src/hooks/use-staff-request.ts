// The `request` option for every generated staff hook (`useListQuoteRequests(params, { request })`): it carries the
// staff bearer token, read at call time. Pass it to every staff query and mutation, on every staff screen.
import { useStaffSession } from '@/components/staff/staff-session';

export function useStaffRequest(): RequestInit {
  return useStaffSession().request;
}
