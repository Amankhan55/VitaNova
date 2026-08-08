import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService } from './core/auth/auth.service';

describe('App shell', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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

  it('shows the branded header once a session exists', () => {
    localStorage.setItem(
      'vitanova.user',
      JSON.stringify({ id: 'u1', email: 'alex@example.com', full_name: 'Alex Morgan' }),
    );
    localStorage.setItem('vitanova.access', 'token');

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.shell-header')).not.toBeNull();
    // Initials are derived from the name, not stored.
    expect(root.querySelector('.avatar')?.textContent?.trim()).toBe('AM');
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
