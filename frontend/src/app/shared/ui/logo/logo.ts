import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The VitaNova mark: a serifed V sitting on a spot-colour rule, the way a
 * masthead sits on the rule that separates it from the page.
 *
 * The letter is drawn rather than set, so it does not shift while the display
 * face loads and does not depend on a font being available at all. It is built
 * from `currentColor`, which is what lets one mark work on bone and on ink —
 * only the rule underneath keeps the accent, and it reads that accent from the
 * theme rather than hard-coding it.
 */
@Component({
  selector: 'vn-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 48 48"
      role="img"
      aria-label="VitaNova"
    >
      <!-- The two arms, mitred at the apex so the join stays a true point. -->
      <path
        d="M14.6 15.4 L24 35.8 L33.4 15.4"
        fill="none"
        stroke="currentColor"
        stroke-width="4.6"
        stroke-linejoin="miter"
      />
      <!-- Slab serifs on each arm. -->
      <rect x="9.4" y="12.8" width="10.4" height="2.9" fill="currentColor" />
      <rect x="28.2" y="12.8" width="10.4" height="2.9" fill="currentColor" />
      <!-- The rule. -->
      <rect x="9.4" y="39.6" width="29.2" height="3" [attr.fill]="rule()" />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; flex: none; }
  `,
})
export class Logo {
  readonly size = input(28);

  /**
   * Overridable so the mark can be placed on a surface that is not themed —
   * the auth poster, for instance, which is dark in both themes.
   */
  readonly rule = input('var(--vn-accent)');
}
