// The SCR-01 form's values and their checks.
//
// The lengths and shapes come from the generated Zod schema (CreateQuoteRequestBody), so the client cannot drift
// from the contract. The phone needs one more rule the contract states in words: the server strips spaces, dashes,
// dots, brackets and a leading +1 and requires exactly 10 digits, so the form shows the same refusal before sending.
// The server checks again; whatever it refuses comes back as a 422 and lands on the same fields.
import type { Resolver } from 'react-hook-form';
import { CreateQuoteRequestBody } from '@/lib/api/generated/public-form/public-form.zod';
import type { Urgency } from '@/lib/api/generated/model';
import { copy } from '@/components/request/copy';

export interface FormValues {
  name: string;
  phone: string;
  email: string;
  address: string;
  problem: string;
  /** '' until she chooses: nothing is preselected. */
  urgency: Urgency | '';
  /** The optional offers box. Starts false, always. */
  offers: boolean;
  /** The honeypot. People never see it, so it stays ''. */
  website: string;
}

export const FIELD_ORDER = ['name', 'phone', 'email', 'address', 'problem', 'urgency'] as const;
export type FieldName = (typeof FIELD_ORDER)[number];
export type FieldMessages = Partial<Record<FieldName, string>>;

export const EMPTY_VALUES: FormValues = {
  name: '',
  phone: '',
  email: '',
  address: '',
  problem: '',
  urgency: '',
  offers: false,
  website: '',
};

/** Spaces, dashes, dots, brackets and a leading +1 removed, as the contract says the server does. */
export function phoneDigits(phone: string): string {
  const stripped = phone.replace(/[\s\-.()]/g, '');
  return stripped.startsWith('+1') ? stripped.slice(2) : stripped;
}

export function isFieldName(value: string): value is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(value);
}

/** What goes in the request body for the five typed answers: trimmed, as a person means them. */
export function cleanAnswers(values: FormValues) {
  return {
    name: values.name.trim(),
    phone: values.phone.trim(),
    email: values.email.trim(),
    address: values.address.trim(),
    problem: values.problem.trim(),
  };
}

export function validateValues(values: FormValues): FieldMessages {
  const answers = cleanAnswers(values);
  const failing = new Set<string>();
  const parsed = CreateQuoteRequestBody.safeParse({
    ...answers,
    urgency: values.urgency === '' ? undefined : values.urgency,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string') failing.add(field);
    }
  }
  if (!/^\d{10}$/.test(phoneDigits(answers.phone))) failing.add('phone');

  const messages: FieldMessages = {};
  if (failing.has('name')) messages.name = copy.fieldErrors.name;
  if (failing.has('phone')) messages.phone = copy.fieldErrors.phone;
  if (failing.has('email')) messages.email = copy.fieldErrors.email;
  if (failing.has('address')) messages.address = copy.fieldErrors.address;
  if (failing.has('problem')) messages.problem = copy.fieldErrors.problem(answers.problem.length);
  if (failing.has('urgency')) messages.urgency = copy.fieldErrors.urgency;
  return messages;
}

/** react-hook-form resolver over validateValues (the Zod resolver package is not a dependency of this app). */
export const formResolver: Resolver<FormValues> = (values) => {
  const messages = validateValues(values);
  if (Object.keys(messages).length === 0) return { values, errors: {} };
  return {
    values: {},
    errors: Object.fromEntries(
      FIELD_ORDER.flatMap((field) => {
        const message = messages[field];
        return message ? [[field, { type: 'validate', message }]] : [];
      }),
    ),
  };
};
