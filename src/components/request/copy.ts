// User-facing words for SCR-01 and SCR-02, in one place. Used exactly as written in docs/design-specs.md "Copy".
// Where the design shows a message but not for every case (name and address), the wording follows the same
// pattern as the designed ones: say what is wrong and how to fix it.
export const copy = {
  title: 'Request a quote',
  lede: "Tell Northside what's wrong and add photos if you can. Northside will get back to you about a quote.",
  required: 'All six questions are required. Photos are optional.',
  requiredKept: 'All six questions are required. Photos are optional. Everything you typed is still here.',

  groups: { details: 'Your details', problem: 'The problem', photos: 'Photos' },
  optional: '(optional)',

  labels: {
    name: 'Your name',
    phone: 'Phone number',
    email: 'Email',
    address: 'Address of the job',
    problem: "What's the problem?",
    urgency: 'How urgent is it?',
  },
  hints: {
    phone: 'Northside may call or text this number.',
    problem: '10 to 2,000 characters.',
    photos: 'Up to 3 photos. JPEG, PNG or WebP, 5 MB or smaller each. Only Northside staff can see them.',
  },
  urgency: {
    emergency: { label: 'Emergency', description: 'Active leak or no water, need someone today' },
    soon: { label: 'Soon', description: 'Within the next few days' },
    flexible: { label: 'Flexible', description: 'Within the next two weeks, no rush' },
  },

  offers: 'Email me offers and news from Northside. This is optional.',
  dataUse:
    'Northside will use these details to reply to your quote request. It will email you offers only if you tick the box.',
  send: 'Send request',
  sending: 'Sending',
  sendingStatus: 'Sending your request',

  photos: {
    add: 'Add a photo',
    limit: 'You can add up to 3 photos',
    tooBig: 'Each photo must be 5 MB or smaller',
    wrongType: 'Photos must be JPEG, PNG or WebP',
    uploadFailed: "This photo didn't upload. Check your connection, then tap Send request to try again.",
    list: 'Attached photos',
    uploaded: 'uploaded',
    removeLabel: (name: string) => `Remove photo ${name}`,
    uploading: (position: number, total: number) => `Uploading ${position} of ${total}`,
  },

  fieldErrors: {
    name: 'Enter your name, 2 to 100 characters.',
    phone: 'Enter a 10-digit phone number, like 905-555-0142.',
    email: 'Enter an email address like name@example.com.',
    address: 'Enter the address of the job, 5 to 200 characters.',
    problem: (written: number) => `Describe the problem in 10 to 2,000 characters. You have written ${written}.`,
    urgency: 'Choose how urgent it is.',
  },
  summary: {
    title: (count: number) =>
      count === 1 ? 'Your request has not been sent. Fix this:' : `Your request has not been sent. Fix these ${count} things:`,
    items: {
      name: 'Your name: enter your name',
      phone: 'Phone number: enter a 10-digit number',
      email: 'Email: enter a valid address',
      address: 'Address of the job: enter the address',
      problem: "What's the problem: use 10 to 2,000 characters",
      urgency: 'How urgent is it: choose one',
    },
    photos: (count: number) => (count === 1 ? 'Photos: 1 photo was refused' : `Photos: ${count} photos were refused`),
  },

  failed: {
    title: "We couldn't send your request. Please try again.",
    body: 'Nothing was sent and no reference number was issued. Everything you typed and your photos are still here.',
  },
  rateLimited: {
    title: 'Too many requests. Please try again in a few minutes.',
    body: 'Everything you typed and your photos are still here.',
  },

  sent: {
    status: 'Request sent',
    heading: (firstName: string) => `Thanks, ${firstName}. Northside has your request.`,
    referenceHeading: 'YOUR REFERENCE NUMBER',
    copyButton: 'Copy reference number',
    copyFailed: "Couldn't copy. Select the number and copy it by hand.",
    nextHeading: 'What happens next',
    next: [
      'Northside reads your request and contacts you using the phone number or email you gave.',
      'No email or text is sent to you now, so write the number down or take a screenshot. Quote it if you call or text Northside about this request.',
    ],
    recapHeading: 'WHAT YOU SENT',
    recap: { phone: 'PHONE', address: 'ADDRESS', urgency: 'URGENCY', photos: 'PHOTOS' },
    photosAttached: (count: number) => (count === 0 ? 'None' : `${count} attached`),
    another: 'Send another request',
  },
} as const;
