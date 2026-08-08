import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AuthService } from './core/auth/auth.service';
import { Icon } from './shared/ui/icon/icon';
import { Logo } from './shared/ui/logo/logo';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The editor and the auth screens each own the full viewport. */
  protected readonly showHeader = computed(() => {
    const url = this.url();
    return this.auth.isAuthenticated() && !url.startsWith('/login') && !url.startsWith('/register');
  });

  protected readonly initials = computed(() => {
    const user = this.auth.user();
    if (!user) return '';
    const source = user.full_name.trim() || user.email;
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    if (parts.length === 0) return '';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
  });

  protected signOut(): void {
    this.auth.logout();
  }
}
