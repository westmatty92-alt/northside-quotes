'use client';
// FIXTURE. Lines marked "expect:" must be flagged with that rule; all others must not.
const GHL_ORIGIN = 'https://app.gohighlevel.com';

export function notifyParent(msg: { type: string }) {
  window.parent.postMessage(msg, '*'); // expect: baseleap-postmessage-wildcard
  window.parent.postMessage(msg, GHL_ORIGIN);
}

export const publicConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  stripe: process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY, // expect: baseleap-public-env-secret-name
};
