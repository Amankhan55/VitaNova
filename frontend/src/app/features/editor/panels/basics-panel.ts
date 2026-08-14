import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LIMITS } from '../../../core/models/limits';
import { Basics, LinkIcon, ResumeLink } from '../../../core/models/resume.model';
import { Icon } from '../../../shared/ui/icon/icon';
import { ResumeStore } from '../resume-store';

const LINK_ICONS: LinkIcon[] = ['link', 'linkedin', 'github', 'globe', 'mail', 'phone', 'pin'];

@Component({
  selector: 'vn-basics-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    @if (basics(); as value) {
      <label class="vn-field">
        <span class="vn-label">Full name</span>
        <input
          class="vn-input"
          type="text"
          [attr.maxlength]="limits.short"
          [ngModel]="value.full_name"
          (ngModelChange)="patch({ full_name: $event })"
          placeholder="Alex Morgan"
        />
      </label>

      <label class="vn-field">
        <span class="vn-label">Headline</span>
        <input
          class="vn-input"
          type="text"
          [attr.maxlength]="limits.line"
          [ngModel]="value.headline"
          (ngModelChange)="patch({ headline: $event })"
          placeholder="Senior Software &amp; UI Developer"
        />
      </label>

      <div class="pair">
        <label class="vn-field">
          <span class="vn-label">Email</span>
          <input
            class="vn-input"
            type="email"
            [attr.maxlength]="limits.short"
          [ngModel]="value.email"
            (ngModelChange)="patch({ email: $event })"
            placeholder="you@example.com"
          />
        </label>

        <label class="vn-field">
          <span class="vn-label">Phone</span>
          <input
            class="vn-input"
            type="tel"
            [attr.maxlength]="limits.short"
          [ngModel]="value.phone"
            (ngModelChange)="patch({ phone: $event })"
            placeholder="+1 (555) 000-0000"
          />
        </label>
      </div>

      <div class="pair">
        <label class="vn-field">
          <span class="vn-label">Location</span>
          <input
            class="vn-input"
            type="text"
            [attr.maxlength]="limits.short"
          [ngModel]="value.location"
            (ngModelChange)="patch({ location: $event })"
            placeholder="San Francisco, CA"
          />
        </label>

        <label class="vn-field">
          <span class="vn-label">Monogram</span>
          <input
            class="vn-input"
            type="text"
            [attr.maxlength]="limits.initials"
            [ngModel]="value.initials"
            (ngModelChange)="patch({ initials: $event })"
            [placeholder]="derivedInitials(value.full_name)"
          />
          <span class="vn-hint">Shown by the sidebar design. Left blank, we use your initials.</span>
        </label>
      </div>

      <div class="links">
        <span class="vn-label">Links</span>

        @for (link of value.links; track $index) {
          <div class="link-row">
            <select
              class="vn-select icon-select"
              [ngModel]="link.icon"
              (ngModelChange)="updateLink($index, { icon: $event })"
              aria-label="Link type"
            >
              @for (option of linkIcons; track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>

            <input
              class="vn-input"
              type="text"
              [attr.maxlength]="limits.short"
              [ngModel]="link.label"
              (ngModelChange)="updateLink($index, { label: $event })"
              placeholder="linkedin.com/in/you"
            />

            <button
              class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
              type="button"
              aria-label="Remove link"
              (click)="removeLink($index)"
            >
              <vn-icon name="x" [size]="15" />
            </button>
          </div>
        }

        <button class="vn-btn vn-btn--sm vn-btn--ghost add" type="button"
                [disabled]="!canAddLink()" (click)="addLink()">
          <vn-icon name="plus" [size]="14" />
          Add link
        </button>
      </div>
    }
  `,
  styles: `
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .links { margin-top: 4px; }
    .link-row { display: flex; align-items: flex-start; gap: 5px; margin-bottom: 6px; }
    .link-row > input { flex: 1; min-width: 0; }
    .link-row .vn-btn { margin-top: 3px; color: var(--vn-text-subtle); }
    .icon-select { width: 108px; flex: none; text-transform: capitalize; }
    .add { padding-left: 4px; }
  `,
})
export class BasicsPanel {
  private readonly store = inject(ResumeStore);

  protected readonly linkIcons = LINK_ICONS;
  protected readonly limits = LIMITS;

  protected basics(): Basics | null {
    return this.store.resume()?.basics ?? null;
  }

  protected patch(changes: Partial<Basics>): void {
    this.store.update((resume) => ({ ...resume, basics: { ...resume.basics, ...changes } }));
  }

  /** Preview of what the sidebar will show when the field is left blank. */
  protected derivedInitials(fullName: string): string {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'AM';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  protected updateLink(index: number, changes: Partial<ResumeLink>): void {
    const links = [...(this.basics()?.links ?? [])];
    links[index] = { ...links[index], ...changes };
    this.patch({ links });
  }

  protected removeLink(index: number): void {
    this.patch({ links: (this.basics()?.links ?? []).filter((_, i) => i !== index) });
  }

  protected canAddLink(): boolean {
    return (this.basics()?.links ?? []).length < LIMITS.maxLinks;
  }

  protected addLink(): void {
    if (!this.canAddLink()) return;
    this.patch({ links: [...(this.basics()?.links ?? []), { label: '', url: '', icon: 'link' }] });
  }
}
