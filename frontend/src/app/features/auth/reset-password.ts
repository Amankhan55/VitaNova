import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { readError } from './read-error';

/** Where the emailed reset link lands. */
@Component({
  selector: 'vn-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo, ThemeToggle],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>

      <h1>Pick something <em>new</em>.</h1>
      <p>
        Setting a new password signs out anywhere your account was still open, so if somebody else
        had it, they no longer do.
      </p>
    </section>

    <section class="panel">
      <div class="panel-top">
        <a class="panel-home" routerLink="/login">
          <vn-icon name="arrow-left" [size]="15" />
          Sign in
        </a>
        <vn-theme-toggle [compact]="true" />
      </div>

      @if (done()) {
        <div class="form-wrap status">
          <span class="status-icon"><vn-icon name="check" [size]="26" /></span>
          <h2>Password changed</h2>
          <p>Sign in with your new password. Taking you there…</p>
          <a class="vn-btn vn-btn--primary submit" routerLink="/login">Sign in</a>
        </div>
      } @else {
        <div class="form-wrap">
          <h2>Choose a new password</h2>
          <p class="form-lead">Make it one you have not used elsewhere.</p>

          @if (error(); as message) {
            <div class="form-error" role="alert">
              <vn-icon name="x" [size]="15" />
              <span>{{ message }}</span>
            </div>
          }

          @if (!token) {
            <p class="alt">
              This page needs the link from your email.
              <a routerLink="/forgot-password">Request a new one</a>
            </p>
          } @else {
            <form (ngSubmit)="submit()" #form="ngForm" novalidate>
              <label class="vn-field">
                <span class="vn-label">New password</span>
                <input
                  class="vn-input"
                  type="password"
                  name="password"
                  autocomplete="new-password"
                  required
                  minlength="8"
                  [(ngModel)]="password"
                  placeholder="At least 8 characters"
                />
                <span class="vn-hint">Use 8 characters or more.</span>
              </label>

              <label class="vn-field">
                <span class="vn-label">Confirm password</span>
                <input
                  class="vn-input"
                  type="password"
                  name="confirmation"
                  autocomplete="new-password"
                  required
                  [(ngModel)]="confirmation"
                  placeholder="Type it again"
                />
                @if (mismatch()) {
                  <span class="vn-hint">Both passwords need to match.</span>
                }
              </label>

              <button
                class="vn-btn vn-btn--primary submit"
                type="submit"
                [disabled]="busy() || form.invalid || mismatch()"
              >
                {{ busy() ? 'Saving…' : 'Set new password' }}
              </button>
            </form>

            <p class="alt">Changed your mind? <a routerLink="/login">Back to sign in</a></p>
          }
        </div>
      }
    </section>
  `,
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';

  protected password = '';
  protected confirmation = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal(false);

  /** Only complains once there is something in the second box to compare. */
  protected mismatch(): boolean {
    return this.confirmation.length > 0 && this.password !== this.confirmation;
  }

  protected submit(): void {
    if (this.busy() || this.mismatch()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.resetPassword(this.token, this.password).subscribe({
      // The reset revoked every session, so there is no signing them in from
      // here — they arrive at the login form with the password they just chose.
      next: () => {
        this.busy.set(false);
        this.done.set(true);
        setTimeout(() => void this.router.navigate(['/login']), 1600);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'That reset link is invalid or has expired.'));
      },
    });
  }
}
