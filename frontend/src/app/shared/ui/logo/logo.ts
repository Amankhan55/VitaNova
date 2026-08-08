import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The VitaNova mark, inlined so the "V" picks up `currentColor` and inverts
 * correctly on dark surfaces (an <img> could not do that). The leaf keeps the
 * brand gradient in every context.
 *
 * The gradient id is per-instance: two inlined SVGs sharing one id would make
 * the second instance reference the first one's (possibly removed) gradient.
 */
@Component({
  selector: 'vn-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" role="img" aria-label="VitaNova">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="16" y1="26" x2="32" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#0D9488" />
          <stop offset="1" stop-color="#34D399" />
        </linearGradient>
      </defs>
      <path d="M24 4C32 11 32 19 24 26C16 19 16 11 24 4Z" [attr.fill]="'url(#' + gradientId + ')'" />
      <path d="M24 8.5V23.5" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.65" />
      <path
        d="M9 18L24 43L39 18"
        fill="none"
        stroke="currentColor"
        stroke-width="6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
  `,
})
export class Logo {
  readonly size = input(28);

  private static nextId = 0;
  protected readonly gradientId = `vn-leaf-${Logo.nextId++}`;
}
