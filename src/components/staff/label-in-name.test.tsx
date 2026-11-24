// @vitest-environment jsdom
// Negative controls for expectLabelsContainVisibleText (WCAG 2.5.3 Label in Name, axe label-content-name-mismatch). Without
// them a jsdom axe run that quietly skips the rule would look like a pass.
//  - BUG-QA1-2: the check FAILS on the old header link, whose aria-label dropped the words the wordmark shows;
//  - BUG-QA1-5: it FAILS on the Move to button named as design-specs words it ("Move NQ-7K3M9P to another status"), which
//    is why the deployed name "Move to another status, NQ-7K3M9P" stays and the spec needs the change.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { staffCopy } from '@/components/staff/copy';
import { expectLabelsContainVisibleText } from '@/components/staff/test-support';
import { Wordmark } from '@/components/ui/site/wordmark';

describe('label in name check (WCAG 2.5.3)', () => {
  it('fails on the old header link: the aria-label replaced the wordmark words', async () => {
    const { container } = render(
      <a href="#home" aria-label="Northside Plumbing, Requests">
        <Wordmark />
      </a>,
    );
    await expect(expectLabelsContainVisibleText(container)).rejects.toThrow(); // the helper's own expect() throws with axe's finding in the diff
  });

  it('passes on the header link as it is now', async () => {
    const { container } = render(
      <a href="#home" aria-label={staffCopy.nav.home}>
        <Wordmark />
      </a>,
    );
    await expectLabelsContainVisibleText(container);
  });

  it('fails on a Move to button named as design-specs words it: "Move" and "to" are apart in the name', async () => {
    const { container } = render(<button aria-label="Move NQ-7K3M9P to another status">Move to</button>);
    await expect(expectLabelsContainVisibleText(container)).rejects.toThrow();
  });

  it('passes on a Move to button named as deployed: "Move to another status, NQ-7K3M9P"', async () => {
    const { container } = render(<button aria-label={staffCopy.list.moveLabel('NQ-7K3M9P')}>Move to</button>);
    await expectLabelsContainVisibleText(container);
  });

  it('passes on a photo thumbnail named as design-specs words it, and fails on the old tile text against it', async () => {
    const good = render(<button aria-label={staffCopy.detail.viewPhotoLabel(2, 3)}>{staffCopy.detail.viewPhoto(2)}</button>);
    await expectLabelsContainVisibleText(good.container);
    good.unmount();
    const old = render(<button aria-label="Open photo 2 of 3 at full size">View photo 2</button>);
    await expect(expectLabelsContainVisibleText(old.container)).rejects.toThrow();
  });
});
