// @vitest-environment jsdom
// The wordmark's two lines read to a checker as "NORTHSIDE PLUMBING · HAMILTON" (with a space), never "NORTHSIDEPLUMBING"
// (BUG-QA1-2: axe joins the text nodes it can see, and the staff header link's name has to contain them).
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Wordmark } from '@/components/ui/site/wordmark';

it('the wordmark keeps a space between its two lines of text', () => {
  const { container } = render(<Wordmark />);
  expect(container.querySelector('svg')).toHaveAccessibleName('Northside Plumbing, Hamilton');
  expect(container.querySelector('svg text')?.textContent).toBe('NORTHSIDE PLUMBING · HAMILTON');
});
