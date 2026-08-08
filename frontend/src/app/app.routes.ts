import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
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
    path: 'editor/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/editor/editor').then((m) => m.EditorPage),
    title: 'Editor — VitaNova',
  },
  { path: '**', redirectTo: 'dashboard' },
];
