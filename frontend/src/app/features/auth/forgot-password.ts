import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { readError } from './read-error';

@Component({
  selector: 'vn-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo, ThemeToggle],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <a class="pitch-back" routerLink="/login">
        <vn-icon name="arrow-left" [size]="15" />
        Back to sign in
      </a>

      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>

      <h1>Happens to <em>everyone</em>.</h1>
      <p>
        Tell us the address on your account and we will send a link that lets you set a new
        password. Your resumes are untouched — they are waiting exactly as you left them.
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

      @if (sent()) {
        <div class="form-wrap status">
          <span class="status-icon"><vn-icon name="mail" [size]="26" /></span>
          <h2>Check your inbox</h2>
          <p>
            If <strong>{{ email }}</strong> has an account, a reset link is on its way. It works
            once and expires in an hour.
          </p>
          <p>
            Wrong address?
            <button class="inline-action" type="button" (click)="sent.set(false)">
              Try another one</button
            >.
          </p>
          <a class="vn-btn vn-btn--soft submit" routerLink="/login">Back to sign in</a>
        </div>
      } @else {
        <div class="form-wrap">
          <h2>Reset your password</h2>
          <p class="form-lead">We will email you a link to choose a new one.</p>

          @if (error(); as message) {
            <div class="form-error" role="alert">
              <vn-icon name="x" [size]="15" />
              <span>{{ message }}</span>
            </div>
          }

          <form (ngSubmit)="submit()" #form="ngForm" novalidate>
            <label class="vn-field">
              <span class="vn-label">Email</span>
              <input
                class="vn-input"
                type="email"
                name="email"
                autocomplete="email"
                required
                [(ngModel)]="email"
                placeholder="you@example.com"
              />
            </label>

            <button
              class="vn-btn vn-btn--primary submit"
              type="submit"
              [disabled]="busy() || form.invalid"
            >
              {{ busy() ? 'Sending…' : 'Send reset link' }}
            </button>
          </form>

          <p class="alt">Remembered it? <a routerLink="/login">Sign in</a></p>
        </div>
      }
    </section>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);

  protected email = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal(false);

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.forgotPassword(this.email.trim()).subscribe({
      // The server answers the same way whether or not the account exists, and
      // so does this screen — otherwise the form becomes a way to check which
      // addresses are registered.
      next: () => {
        this.busy.set(false);
        this.sent.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not send the email. Please try again.'));
      },
    });
  }
}
