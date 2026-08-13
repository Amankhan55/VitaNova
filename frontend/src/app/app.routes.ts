import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/landing/landing').then((m) => m.LandingPage),
    title: 'VitaNova — your career, beautifully set',
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
    title: 'Sign in — VitaNova',
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then((m) => m.RegisterPage),
    title: 'Create account — VitaNova',
  },
  {
    // Reached from an emailed link, so no guard: a signed-in user confirming a
    // second account must not be bounced to the dashboard instead.
    path: 'verify-email',
    loadComponent: () => import('./features/auth/verify-email').then((m) => m.VerifyEmailPage),
    title: 'Confirm your email — VitaNova',
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password').then((m) => m.ForgotPasswordPage),
    title: 'Reset your password — VitaNova',
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPasswordPage),
    title: 'Choose a new password — VitaNova',
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.DashboardPage),
    title: 'Your resumes — VitaNova',
  },
  {
    path: 'templates',
    canActivate: [authGuard],
    loadComponent: () => import('./features/templates/gallery').then((m) => m.GalleryPage),
    title: 'Templates — VitaNova',
  },
  {
    // Declared before `templates` would matter only if that route had children;
    // it is kept adjacent so the pair reads as one section of the app. `new` is
    // handled by the same page — an id of 'new' simply means "not saved yet".
    path: 'templates/custom/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/templates/template-editor').then((m) => m.TemplateEditorPage),
    title: 'Design a template — VitaNova',
  },
  {
    path: 'editor/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/editor/editor').then((m) => m.EditorPage),
    title: 'Editor — VitaNova',
  },
  { path: '**', redirectTo: '' },
];
