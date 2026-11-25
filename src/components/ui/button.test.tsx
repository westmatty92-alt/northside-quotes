// @vitest-environment jsdom
// DV1 F-01: a paused (busy or unavailable) button keeps its designed height, 48 px primary and 44 px secondary, so
// "Sending", "Saving", "Sign in" while pending, Previous / Next at the ends, "Add a photo" at the limit, Retry and
// Move to while saving never shrink to their text and nothing jumps when they pause. The real-browser height is also
// measured for the photo viewer's buttons in src/components/staff/photo-viewer.layout.test.tsx.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, type ButtonVariant } from '@/components/ui/button';

afterEach(cleanup);

const designedHeight: Record<ButtonVariant, string> = { primary: 'min-h-12', secondary: 'min-h-11' };
const variants = Object.keys(designedHeight) as ButtonVariant[];

describe('Button keeps its touch height whether or not it is paused (DV1 F-01)', () => {
  for (const variant of variants) {
    it(`${variant}: ${designedHeight[variant]} when live and when paused`, () => {
      const { rerender } = render(<Button variant={variant}>Save price and note</Button>);
      expect(screen.getByRole('button', { name: 'Save price and note' })).toHaveClass(designedHeight[variant]);

      rerender(
        <Button variant={variant} paused>
          Saving
        </Button>,
      );
      const paused = screen.getByRole('button', { name: 'Saving' });
      expect(paused).toHaveClass(designedHeight[variant]);
      // still the paused look and announcement
      expect(paused).toHaveAttribute('aria-disabled', 'true');
      expect(paused).toHaveClass('border-dashed', 'cursor-not-allowed');
    });

    it(`${variant}: a paused button carries exactly one height, so nothing in the paused look can undo it`, () => {
      render(
        <Button variant={variant} paused>
          Sending
        </Button>,
      );
      const heights = Array.from(screen.getByRole('button', { name: 'Sending' }).classList).filter((name) => name.startsWith('min-h-'));
      expect(heights).toEqual([designedHeight[variant]]);
    });
  }

  it('the default variant (secondary) keeps 44 px when paused', () => {
    render(<Button paused>Retry copy</Button>);
    expect(screen.getByRole('button', { name: 'Retry copy' })).toHaveClass('min-h-11');
  });

  it('a press on a paused button does nothing; a live one runs', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button paused onClick={onClick}>
        Next photo
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(onClick).not.toHaveBeenCalled();
    rerender(<Button onClick={onClick}>Next photo</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
