import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService } from './core/auth/auth.service';
import { ThemeService } from './core/theme/theme.service';

/** A signed-in session, as AuthService reads it back from storage on startup. */
function signIn(): void {
  localStorage.setItem(
    'vitanova.user',
    JSON.stringify({ id: 'u1', email: 'alex@example.com', full_name: 'Alex Morgan' }),
  );
  localStorage.setItem('vitanova.access', 'token');
}

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: 'dashboard', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.clear());

  it('creates', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('hides the navigation header while signed out', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector('.shell-header');
    expect(header).toBeNull();
  });

  it('leaves the landing page to draw its own chrome, even when signed in', async () => {
    signIn();
    await TestBed.inject(Router).navigateByUrl('/');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.shell-header')).toBeNull();
  });

  it('shows the branded header on an app route once a session exists', async () => {
    signIn();
    await TestBed.inject(Router).navigateByUrl('/dashboard');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.shell-header')).not.toBeNull();
    // Initials are derived from the name, not stored.
    expect(root.querySelector('.avatar')?.textContent?.trim()).toBe('AM');
  });

  it('opens and closes the account menu', async () => {
    signIn();
    await TestBed.inject(Router).navigateByUrl('/dashboard');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    root.querySelector<HTMLButtonElement>('.avatar-button')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.menu')).not.toBeNull();

    // Any click outside the trigger dismisses it.
    document.body.click();
    fixture.detectChanges();
    expect(root.querySelector('.menu')).toBeNull();
  });
});

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => localStorage.clear());

  it('starts unauthenticated when storage is empty', () => {
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });

  it('recovers from a corrupt stored user rather than trapping the session', () => {
    localStorage.setItem('vitanova.user', '{not json');
    const auth = TestBed.inject(AuthService);
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('vitanova.user')).toBeNull();
  });
});

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({ providers: [] });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the system by default, without writing to storage', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.mode()).toBe('system');
    expect(localStorage.getItem('vitanova.theme')).toBeNull();
  });

  it('writes the chosen theme to the document and to storage', () => {
    const theme = TestBed.inject(ThemeService);

    theme.set('dark');
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('vitanova.theme')).toBe('dark');

    theme.toggle();
    expect(theme.mode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('drops the stored override when handed back to the system', () => {
    const theme = TestBed.inject(ThemeService);
    theme.set('dark');
    theme.set('system');
    expect(localStorage.getItem('vitanova.theme')).toBeNull();
  });
});
