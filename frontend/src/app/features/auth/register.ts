import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { readError } from './login';

@Component({
  selector: 'vn-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>
      <h1>A new chapter starts here.</h1>
      <p>
        Create an account and your work is saved as you type. Switch designs whenever you like —
        your content is stored independently of how it looks, so nothing is ever re-entered.
      </p>
      <ul class="pitch-list">
        <li><vn-icon name="check" [size]="17" /> Autosaves while you write</li>
        <li><vn-icon name="check" [size]="17" /> Swap designs without losing a word</li>
        <li><vn-icon name="check" [size]="17" /> Export a print-ready PDF in one click</li>
      </ul>
    </section>

    <section class="panel">
      <div class="form-wrap">
        <h2>Create your account</h2>
        <p class="form-lead">Free, and takes about twenty seconds.</p>

        @if (error(); as message) {
          <div class="form-error" role="alert">
            <vn-icon name="x" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }

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

          <button class="vn-btn vn-btn--primary submit" type="submit" [disabled]="busy() || form.invalid">
            {{ busy() ? 'Creating account…' : 'Create account' }}
          </button>
        </form>

        <p class="alt">Already have an account? <a routerLink="/login">Sign in</a></p>
      </div>
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

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.register(this.email.trim(), this.password, this.fullName.trim()).subscribe({
      next: () => void this.router.navigate(['/templates']),
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not create your account. Please try again.'));
      },
    });
  }
}
