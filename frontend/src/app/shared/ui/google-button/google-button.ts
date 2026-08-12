import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/theme/theme.service';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The official Google Sign-In button.
 *
 * Google insists on drawing this itself — the branding is not ours to
 * reproduce — so the component's job is to load their script, hand it a slot,
 * and emit the ID token that comes back. The server verifies that token; it is
 * never trusted here.
 *
 * Renders nothing at all when the API reports no client ID, which is how a
 * deployment without Google configured behaves.
 */
@Component({
  selector: 'vn-google-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (available()) {
      <div class="google-wrap">
        <div class="google-slot" #slot></div>
        @if (busy()) {
          <div class="google-veil"></div>
        }
      </div>
    }
  `,
  styles: `
    .google-wrap {
      position: relative;
      display: flex;
      justify-content: center;
      /* Google's iframe reports its height late; reserving it stops the form
         below from jumping once the button paints. */
      min-height: 44px;
    }

    /* Blocks a second click while the first credential is in flight, without
       tearing down Google's button (which would drop the popup with it). */
    .google-veil {
      position: absolute;
      inset: 0;
      cursor: progress;
      background: color-mix(in srgb, var(--vn-surface) 55%, transparent);
    }
  `,
})
export class GoogleButton {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly zone = inject(NgZone);

  /** Disables the button while the emitted credential is being exchanged. */
  readonly busy = input(false);
  readonly credential = output<string>();
  readonly failed = output<string>();

  protected readonly available = signal(false);
  private readonly slot = viewChild<ElementRef<HTMLDivElement>>('slot');

  private clientId = '';

  constructor() {
    this.auth.providers().subscribe((providers) => {
      if (providers.google_client_id) {
        this.clientId = providers.google_client_id;
        this.available.set(true);
      }
    });

    // Runs once the slot exists, and again whenever the theme flips — Google's
    // button is a rendered iframe, so matching the surrounding page means
    // asking them to draw it again.
    effect(() => {
      const slot = this.slot()?.nativeElement;
      const dark = this.theme.isDark();
      if (!slot) return;
      void this.render(slot, dark);
    });
  }

  private async render(slot: HTMLElement, dark: boolean): Promise<void> {
    try {
      await loadGis();
    } catch {
      // Script blocked, offline, or Google is down. Sign-in by password still
      // works, so drop the button rather than showing one that cannot work.
      this.available.set(false);
      return;
    }

    window.google?.accounts.id.initialize({
      client_id: this.clientId,
      // Google calls back outside Angular's zone; re-enter so the emitted
      // credential drives change detection like any other event.
      callback: (response) =>
        this.zone.run(() => {
          if (response.credential) this.credential.emit(response.credential);
          else this.failed.emit('Google did not return a sign-in token.');
        }),
    });

    slot.replaceChildren();
    window.google?.accounts.id.renderButton(slot, {
      type: 'standard',
      theme: dark ? 'filled_black' : 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(slot.clientWidth || 360, 400),
    });
  }
}

let gisLoader: Promise<void> | undefined;

/** Loads Google Identity Services once per page, whoever asks first. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoader ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry instead of caching the failure forever.
      gisLoader = undefined;
      reject(new Error('Could not load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return gisLoader;
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleButtonOptions {
  type: 'standard' | 'icon';
  theme: 'outline' | 'filled_blue' | 'filled_black';
  size: 'small' | 'medium' | 'large';
  text: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment: 'left' | 'center';
  width: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }): void;
          renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
        };
      };
    };
  }
}
