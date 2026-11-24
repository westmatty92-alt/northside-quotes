// User-facing words for the staff screens (SCR-03, 04, 06, 07, 08), in one place, used as written in
// docs/design-specs.md "Copy". Where the design shows a message but not a sentence around it, the wording follows
// the mockups. Words the design does not give are marked "(FE2)" for the designer to confirm.
import type { Status, Urgency } from '@/lib/api/generated/model';

export const statusLabel: Record<Status, string> = { new: 'New', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
export const statusOrder: readonly Status[] = ['new', 'quoted', 'won', 'lost'];

export const urgencyDescription: Record<Urgency, string> = {
  emergency: 'Active leak or no water, need someone today',
  soon: 'Within the next few days',
  flexible: 'Within the next two weeks, no rush',
};

export const staffCopy = {
  nav: {
    label: 'Main',
    requests: 'Requests',
    pipeline: 'Pipeline',
    signOut: 'Sign out',
    signedInAs: (name: string) => `Signed in as ${name}`,
    skip: 'Skip to main content',
    // starts with the words the wordmark shows (WCAG 2.5.3 Label in Name) and then says where the link goes
    home: 'Northside Plumbing, Hamilton: Requests',
  },

  signIn: {
    title: 'Staff sign-in',
    lede: 'For the Northside owner and office helper.',
    email: 'Email',
    password: 'Password',
    show: 'Show',
    hide: 'Hide',
    submit: 'Sign in',
    submitting: 'Signing in',
    noSignUp: 'Accounts are created by Baseleap. There is no sign-up on this page.',
    emailMissing: 'Enter your email address.', // (FE2)
    passwordMissing: 'Enter your password.', // (FE2)
    ended: {
      title: 'Your session ended.',
      body: 'Your last change was not saved. Sign in again, then check the request.',
    },
    wrong: { title: 'Email or password is incorrect', body: 'Check both and try again. Your email is still filled in.' },
    paused: {
      title: 'Too many sign-in attempts. Try again in a few minutes.',
      body: 'Sign-in is paused for a short while, even with the right password. This message is the same for every account and every reason.',
    },
    unavailable: {
      title: 'Sign-in is unavailable. Try again in a few minutes.',
      body: 'Your password was not checked. If it keeps happening, phone Baseleap.',
    },
    failed: { title: "Couldn't sign in. Try again.", body: 'Check your connection. Your email is still filled in.' }, // (FE2)
  },

  week: {
    label: 'THIS WEEK',
    requests: 'Requests this week',
    won: 'Won',
    lost: 'Lost',
    unavailable: 'Count unavailable',
    retry: 'Try again',
    loading: 'Loading the weekly count',
  },

  list: {
    title: 'Requests',
    filterGroup: 'Show requests',
    filterAll: 'All',
    searchLabel: 'Search by reference, name or phone',
    searchPlaceholder: 'Reference, name or phone',
    searchButton: 'Search',
    searchRegion: 'Search requests',
    listHeading: 'Quote requests, newest first',
    columns: ['Reference', 'Name', 'Urgency', 'Status', 'Submitted'] as const,
    moveTo: 'Move to',
    // Starts with the visible words "Move to" (WCAG 2.5.3 Label in Name) and carries the reference (the design's rule for
    // repeated buttons). NOT the wording of design-specs ("Move NQ-7K3M9P to another status"): its words "Move" and "to" are
    // not together, so axe's label-content-name-mismatch fails it against the visible "Move to" (negative control in
    // tmp-debug.test.tsx). The spec needs the change, not this label.
    moveLabel: (reference: string) => `Move to another status, ${reference}`,
    moveMenu: (reference: string) => `Move ${reference} to`,
    loading: 'Loading requests',
    showMore: 'Show more',
    loadingMore: 'Loading more',
    loadFailed: "Couldn't load requests. Try again.",
    loadFailedBody: "The list is not shown, so you don't mistake it for an empty filter.",
    retry: 'Try again',
    saveFailed: "Couldn't save. Try again.",
    saveFailedBody: (reference: string, status: string) => `${reference} is still ${status}. Nothing was changed.`,
    stale: 'This request was changed by someone else. Reload to see the latest.',
    reload: 'Reload',
    moved: (reference: string, status: string) => `${reference} moved to ${status}`,
    emptyTitle: 'No quote requests yet',
    emptyBody: 'Requests from the Request a quote page show up here, newest first, with their photos.',
    emptyAction: 'Open the Request a quote page',
    emptyFilter: (status: string) => `No ${status.toLowerCase()} requests`,
    emptySearch: 'No matching requests',
    showAll: 'Show all requests',
  },

  detail: {
    backTo: (tab: 'Requests' | 'Pipeline') => `Back to ${tab}`,
    requestHeading: 'The request',
    phone: 'PHONE',
    email: 'EMAIL',
    address: 'ADDRESS OF THE JOB',
    urgency: 'URGENCY',
    problem: 'THE PROBLEM',
    callLabel: (phone: string) => `Call ${phone}`,
    emailLabel: (firstName: string) => `Email ${firstName}`,
    submitted: (when: string) => `Submitted ${when} (Hamilton time)`,
    loading: 'Loading the request',
    loadFailed: "Couldn't load this request. Try again.",
    notFound: 'This request was not found.',
    notFoundBody: 'It may have been removed, or the address is wrong.',
    photos: 'Photos',
    noPhotos: 'No photos',
    noPhotosBody: 'The homeowner did not attach any. Call or text the number above if you need to see the problem.',
    photosHint: 'Tap a photo to see it at full size. Only signed-in staff can open photos.',
    photosUnavailableHint: 'The rest of the request is still shown. Reload the page to try the photos again.',
    photoUnavailable: 'Photo unavailable',
    // design-specs "PhotoThumb" and the SCR-06 mockup: the tile shows "Photo 2" and the button is named "Open photo 2 of 3
    // at full size", which contains the visible words (WCAG 2.5.3 Label in Name)
    viewPhoto: (position: number) => `Photo ${position}`,
    viewPhotoLabel: (position: number, total: number) => `Open photo ${position} of ${total} at full size`,
    quote: 'Your quote',
    quoteEmpty: 'No price or note yet. Both are optional, and you can save either one alone.',
    price: 'Price quoted, in Canadian dollars',
    optional: '(optional)',
    priceHint: 'From 0.01 to 99,999.99. No tax is added and no payment is taken.',
    priceError: 'Enter an amount from 0.01 to 99,999.99 with at most 2 decimals',
    note: 'Note',
    noteHint: 'Up to 1,000 characters.',
    noteCount: (written: number) => `${written.toLocaleString('en-CA')} of 1,000 characters.`,
    noteError: (written: number) => `Notes can be up to 1,000 characters. This one is ${written.toLocaleString('en-CA')}.`,
    save: 'Save price and note',
    saving: 'Saving',
    saveAgain: 'Try saving again',
    errorSummary: (count: number) => (count === 1 ? 'Nothing was saved. Fix this 1 thing:' : `Nothing was saved. Fix these ${count} things:`),
    errorSummaryPrice: (message: string) => `Price: ${message[0]?.toLowerCase() ?? ''}${message.slice(1)}`,
    errorSummaryNote: 'Note: use 1,000 characters or fewer',
    saved: 'Saved.',
    /** What was stored, by name: "Price $450.00 CAD and your note are stored on NQ-7K3M9P." */
    savedBody: (reference: string, price: string | null, hasNote: boolean) => {
      if (price && hasNote) return `Price ${price} CAD and your note are stored on ${reference}.`;
      if (price) return `Price ${price} CAD is stored on ${reference}.`;
      if (hasNote) return `Your note is stored on ${reference}.`;
      return `${reference} now has no price and no note.`;
    },
    priceLineSuffix: 'CAD, quoted',
    saveFailed: "Couldn't save. Try again.",
    saveFailedBody: 'Your price and note are still here. Nothing was changed on the request.',
    stale: 'This request was changed by someone else. Reload to see the latest.',
    staleBody: 'Their price is still the saved one. Your note is kept below so you can copy it before you reload.',
    reload: 'Reload this request',
    keptNote: 'Your note, not saved',
    status: 'Status',
    statusHint: 'Saving a price does not change the status. Pick the status yourself when it changes. Any status can go to any other.',
    statusSame: 'Choosing the status that is already selected changes nothing.',
    statusFailed: "Couldn't save. Try again.",
    statusFailedBody: (status: string) => `The status is still ${status}. Nothing was changed.`,
    lastUpdated: (name: string | null, when: string) => `Last updated by ${name ?? 'a removed account'} ${when}`,
    notUpdated: 'Not updated yet',
    ghl: 'GoHighLevel',
    ghlCopyLabel: 'CONTACT COPY',
    ghlTagLabel: 'STAGE TAG',
    ghlHint: 'This request lives here. GoHighLevel only gets a copy of the contact and its stage tag.',
    copied: 'Copied to GoHighLevel',
    copyWaiting: 'Waiting to retry',
    copyWaitingHint: "GoHighLevel did not answer. Northside's copy is safe here and the next try is automatic.",
    copyFailed: 'Copy to GoHighLevel failed',
    copyFailedHint: 'Automatic retries have stopped. The request is safe here.',
    lastTried: (when: string) => `Last tried ${when}`,
    retryCopy: 'Retry copy',
    retrying: 'Retrying',
    retryFailed: 'The retry did not work.',
    retryFailedBody: 'GoHighLevel is still not answering. The copy stays marked failed. Try again later.',
    retryUnavailable: 'The retry could not run.', // (FE2)
    retryUnavailableBody: 'It was already running or is not needed. Reload this request to see where it stands.', // (FE2)
    tagUpToDate: 'Stage tag up to date',
    tagWaiting: 'Stage tag waiting to retry',
    tagFailed: 'Stage tag failed',
    tagFailedHint: 'The next status change starts a new try.',
    noConsent: 'Not copied: no offers consent',
    noConsentBody:
      'The homeowner did not tick the box to get offers, so nothing is sent to GoHighLevel for this request, now or when its status changes. The request is fully editable here.',
  },

  viewer: {
    title: (position: number, total: number) => `Photo ${position} of ${total}`,
    meta: (reference: string, name: string) => `${reference}, ${name}`,
    close: 'Close',
    previous: 'Previous photo',
    next: 'Next photo',
    loading: 'Loading photo',
    unavailable: 'Photo unavailable',
    unavailableBody: 'The photo could not be loaded. The request itself is fine.',
    retry: 'Try again',
    alt: (position: number, total: number, reference: string) => `Photo ${position} of ${total} for ${reference}`,
  },
} as const;
