// @vitest-environment jsdom
// SCR-02: the confirmation from the stored receipt, the copy button's states, and the redirect without a receipt.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestSent } from '@/components/request/request-sent';
import { saveReceipt } from '@/components/request/session-store';
import { expectNoAxeViolations } from '@/components/request/test-support';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const receipt = {
  reference: 'NQ-7K3M9P',
  firstName: 'Dana',
  phone: '905-555-0142',
  address: '14 Barton St W, Hamilton ON',
  urgency: 'soon',
  photoCount: 2,
} as const;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('SCR-02 Request sent', () => {
  it('Success: names the homeowner, shows the reference as a spelled-out tag and as real text, says no email or text will arrive, and recaps what was sent', async () => {
    saveReceipt(receipt);
    const { container } = render(<RequestSent />);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Thanks, Dana. Northside has your request.' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const tag = screen.getByRole('img', { name: 'Reference number N Q, 7, K, 3, M, 9, P' });
    expect(tag).toHaveTextContent('NQ-7K3M9P');
    expect(screen.getByRole('heading', { name: 'What happens next' })).toBeInTheDocument();
    expect(screen.getByText(/No email or text is sent to you now/)).toBeInTheDocument();

    const recap = screen.getByRole('heading', { name: 'WHAT YOU SENT' }).closest('section') as HTMLElement;
    expect(within(recap).getByText('905-555-0142')).toBeInTheDocument();
    expect(within(recap).getByText('14 Barton St W, Hamilton ON')).toBeInTheDocument();
    expect(within(recap).getByText('Soon')).toBeInTheDocument();
    expect(within(recap).getByText('2 attached')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send another request' })).toHaveAttribute('href', '/');
    expect(nav.replace).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('announces "Request sent" through a live region that exists before its words arrive', async () => {
    vi.useFakeTimers();
    saveReceipt(receipt);
    const { container } = render(<RequestSent />);
    const status = container.querySelector('p[role="status"]');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(status).toHaveTextContent('Request sent');
  });

  it('a reload in the same tab shows the same number (it reads the stored receipt again)', () => {
    saveReceipt(receipt);
    const first = render(<RequestSent />);
    expect(screen.getByRole('img', { name: /Reference number/ })).toHaveTextContent('NQ-7K3M9P');
    first.unmount();
    render(<RequestSent />);
    expect(screen.getByRole('img', { name: /Reference number/ })).toHaveTextContent('NQ-7K3M9P');
  });

  it('Empty: opened without a receipt it shows nothing and sends the visitor to the form', async () => {
    const { container } = render(<RequestSent />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
    expect(container).toBeEmptyDOMElement();
  });

  it('a stored receipt that is not a receipt is treated as none', async () => {
    window.sessionStorage.setItem('nq.receipt', '{"reference":"NQ-AAAAAA<script>"}');
    render(<RequestSent />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
  });

  it('Copy: puts the reference on the clipboard', async () => {
    saveReceipt(receipt);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RequestSent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy reference number' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('NQ-7K3M9P'));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });

  it('Error: when the clipboard is out of reach it says so and the number is still there to select', async () => {
    saveReceipt(receipt);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const { container } = render(<RequestSent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy reference number' }));
    expect(await screen.findByText("Couldn't copy. Select the number and copy it by hand.")).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Reference number/ })).toHaveTextContent('NQ-7K3M9P');
    await expectNoAxeViolations(container);
  });

  it('looks the same for every urgency, with an icon and the word', () => {
    for (const [urgency, word] of [['emergency', 'Emergency'], ['flexible', 'Flexible']] as const) {
      saveReceipt({ ...receipt, urgency, photoCount: 0 });
      const view = render(<RequestSent />);
      expect(screen.getByText(word)).toBeInTheDocument();
      expect(screen.getByText('None')).toBeInTheDocument();
      view.unmount();
    }
  });
});
