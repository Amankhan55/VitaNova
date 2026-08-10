import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { AuthService } from './core/auth/auth.service';
import { ConfirmDialog } from './shared/ui/confirm/confirm-dialog';
import { Icon } from './shared/ui/icon/icon';
import { Logo } from './shared/ui/logo/logo';
import { ThemeToggle } from './shared/ui/theme-toggle/theme-toggle';

/** Routes that bring their own chrome: the marketing page and the auth screens. */
const PUBLIC_ROUTES = ['/login', '/register'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialog, Icon, Logo, ThemeToggle],
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

  /** The landing page, the editor and the auth screens each own the viewport. */
  protected readonly showHeader = computed(() => {
    const url = this.url().split('?')[0];
    if (!this.auth.isAuthenticated()) return false;
    return url !== '/' && !PUBLIC_ROUTES.some((route) => url.startsWith(route));
  });

  protected readonly menuOpen = signal(false);

  protected readonly user = computed(() => this.auth.user());

  protected readonly initials = computed(() => {
    const user = this.auth.user();
    if (!user) return '';
    const source = user.full_name.trim() || user.email;
    const parts = source.split(/[\s@.]+/).filter(Boolean);
    if (parts.length === 0) return '';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
  });

  /** Any click that is not inside the menu closes it — including on a link. */
  @HostListener('document:click')
  protected closeMenu(): void {
    if (this.menuOpen()) this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.menuOpen.set(false);
  }

  protected toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  protected signOut(): void {
    this.menuOpen.set(false);
    this.auth.logout('/');
  }
}
