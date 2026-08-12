import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { GoogleButton } from '../../shared/ui/google-button/google-button';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { readError } from './read-error';

@Component({
  selector: 'vn-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, GoogleButton, Icon, Logo, ThemeToggle],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <a class="pitch-back" routerLink="/">
        <vn-icon name="arrow-left" [size]="15" />
        Back to vitanova
      </a>

      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>

      <h1>A new chapter <em>starts</em> here.</h1>
      <p>
        Create an account and your work is saved as you type. Switch designs whenever you like —
        your content is stored independently of how it looks, so nothing is ever re-entered.
      </p>
      <ul class="pitch-list">
        <li><vn-icon name="check" [size]="15" /> Autosaves while you write</li>
        <li><vn-icon name="check" [size]="15" /> Swap designs without losing a word</li>
        <li><vn-icon name="check" [size]="15" /> Export a print-ready PDF in one click</li>
      </ul>
    </section>

    <section class="panel">
      <div class="panel-top">
        <a class="panel-home" routerLink="/">
          <vn-icon name="arrow-left" [size]="15" />
          Home
        </a>
        <vn-theme-toggle [compact]="true" />
      </div>

      @if (sent()) {
        <div class="form-wrap status">
          <span class="status-icon"><vn-icon name="mail" [size]="26" /></span>
          <h2>Check your inbox</h2>
          <p>
            We have sent a confirmation link to <strong>{{ email }}</strong
            >. Open it and you will be signed in — the link is good for 24 hours.
          </p>

          @if (resent()) {
            <p>Sent again just now. It can take a minute to arrive.</p>
          } @else {
            <p>
              Nothing there? Check your spam folder, or
              <button class="inline-action" type="button" [disabled]="busy()" (click)="resend()">
                send it again</button
              >.
            </p>
          }

          <a class="vn-btn vn-btn--soft submit" routerLink="/login">Back to sign in</a>
        </div>
      } @else {
        <div class="form-wrap">
          <h2>Create your account</h2>
          <p class="form-lead">Free, and takes about twenty seconds.</p>

          @if (error(); as message) {
            <div class="form-error" role="alert">
              <vn-icon name="x" [size]="15" />
              <span>{{ message }}</span>
            </div>
          }

          <vn-google-button
            [busy]="busy()"
            (credential)="signUpWithGoogle($event)"
            (failed)="error.set($event)"
          />

          <div class="or"><span>or</span></div>

          <form (ngSubmit)="submit()" #form="ngForm" novalidate>
            <label class="vn-field">
              <span class="vn-label">Full name</span>
              <input
                class="vn-input"
                type="text"
                name="fullName"
                autocomplete="name"
                [(ngModel)]="fullName"
                placeholder="Alex Morgan"
              />
            </label>

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

            <label class="vn-field">
              <span class="vn-label">Password</span>
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

            <button
              class="vn-btn vn-btn--primary submit"
              type="submit"
              [disabled]="busy() || form.invalid"
            >
              {{ busy() ? 'Creating account…' : 'Create account' }}
            </button>
          </form>

          <p class="alt">Already have an account? <a routerLink="/login">Sign in</a></p>
        </div>
      }
    </section>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected fullName = '';
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The account exists and the confirmation link is on its way. */
  protected readonly sent = signal(false);
  protected readonly resent = signal(false);

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.register(this.email.trim(), this.password, this.fullName.trim()).subscribe({
      // No session yet — signing in waits on the address being confirmed.
      next: () => {
        this.busy.set(false);
        this.sent.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not create your account. Please try again.'));
      },
    });
  }

  /** Google has already vouched for the address, so this lands straight in the
   * app rather than in the confirmation flow. */
  protected signUpWithGoogle(credential: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.loginWithGoogle(credential).subscribe({
      next: () => void this.router.navigate(['/templates']),
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not sign you up with Google.'));
      },
    });
  }

  protected resend(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.auth.resendVerification(this.email.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.resent.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not send the email. Please try again.'));
      },
    });
  }
}
