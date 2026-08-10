import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConfirmDialog } from './confirm-dialog';
import { ConfirmService } from './confirm.service';

/**
 * The dialog replaces `window.confirm`, so it has to keep that contract: every
 * way out settles the promise exactly once, and cancelling is the default.
 */
describe('ConfirmDialog', () => {
  let fixture: ComponentFixture<ConfirmDialog>;
  let confirm: ConfirmService;

  const sheet = () => (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
  const buttons = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.actions button'));

  const askAndOpen = (options = {}) => {
    const answer = confirm.ask({ title: 'Delete this resume?', message: 'Cannot be undone.', ...options });
    fixture.detectChanges();
    return answer;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ConfirmDialog] }).compileComponents();
    fixture = TestBed.createComponent(ConfirmDialog);
    confirm = TestBed.inject(ConfirmService);
    fixture.detectChanges();
  });

  afterEach(() => {
    confirm.answer(false);
    fixture.destroy();
  });

  it('stays closed until something asks', () => {
    expect(sheet().open).toBe(false);
  });

  it('opens as a modal and shows the question', () => {
    askAndOpen({ title: 'Remove “Skills”?', message: 'Every entry goes with it.' });

    expect(sheet().open).toBe(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Remove “Skills”?');
    expect(text).toContain('Every entry goes with it.');
  });

  it('resolves true when confirmed and closes', async () => {
    const answer = askAndOpen({ confirmLabel: 'Delete' });

    const confirmButton = buttons().find((b) => b.textContent?.trim() === 'Delete') as HTMLButtonElement;
    confirmButton.click();
    fixture.detectChanges();

    await expectAsync(answer).toBeResolvedTo(true);
    expect(sheet().open).toBe(false);
  });

  it('resolves false when cancelled', async () => {
    const answer = askAndOpen();

    const cancel = buttons().find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;
    cancel.click();
    fixture.detectChanges();

    await expectAsync(answer).toBeResolvedTo(false);
  });

  it('treats Escape as cancel', async () => {
    const answer = askAndOpen();

    // What the browser does for Escape on a modal <dialog>.
    sheet().dispatchEvent(new Event('close'));
    fixture.detectChanges();

    await expectAsync(answer).toBeResolvedTo(false);
  });

  it('treats a backdrop click as cancel', async () => {
    const answer = askAndOpen();

    // A backdrop click reports the <dialog> itself as the target.
    sheet().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    await expectAsync(answer).toBeResolvedTo(false);
  });

  it('ignores clicks inside the card', async () => {
    askAndOpen();

    const title = (fixture.nativeElement as HTMLElement).querySelector('#vn-confirm-title')!;
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(sheet().open).toBe(true);
  });

  it('focuses Cancel, not the destructive button', async () => {
    askAndOpen({ confirmLabel: 'Delete', tone: 'danger' });
    // Focus is moved in a microtask, after showModal() picks its own default.
    await Promise.resolve();

    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  });

  it('marks the destructive variant so it does not look routine', () => {
    askAndOpen({ tone: 'danger' });
    expect(sheet().classList).toContain('is-danger');
  });

  it('describes itself to assistive tech', () => {
    askAndOpen();
    expect(sheet().getAttribute('aria-labelledby')).toBe('vn-confirm-title');
    expect(sheet().getAttribute('aria-describedby')).toBe('vn-confirm-message');
  });
});

describe('ConfirmService', () => {
  let confirm: ConfirmService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    confirm = TestBed.inject(ConfirmService);
  });

  it('holds nothing until asked', () => {
    expect(confirm.pending()).toBeNull();
  });

  it('cancels an outstanding question rather than stranding its promise', async () => {
    const first = confirm.ask({ title: 'First', message: '…' });
    const second = confirm.ask({ title: 'Second', message: '…' });

    await expectAsync(first).toBeResolvedTo(false);
    expect(confirm.pending()?.title).toBe('Second');

    confirm.answer(true);
    await expectAsync(second).toBeResolvedTo(true);
  });

  it('ignores an answer when nothing is pending', () => {
    expect(() => confirm.answer(true)).not.toThrow();
  });
});
