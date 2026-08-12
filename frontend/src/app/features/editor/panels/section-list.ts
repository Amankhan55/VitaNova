import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ItemSection,
  ResumeItem,
  ResumeSection,
  SECTION_ICONS,
  SECTION_LABELS,
  SectionType,
  SummarySection,
} from '../../../core/models/resume.model';
import { emptyItemFor, emptySection, isItemSection } from '../../../core/models/resume.factory';
import { ConfirmService } from '../../../shared/ui/confirm/confirm.service';
import { IconName } from '../../../shared/ui/icon/icons';
import { Icon } from '../../../shared/ui/icon/icon';
import { ResumeStore } from '../resume-store';
import { ItemEditor } from './item-editor';

const ADDABLE: SectionType[] = [
  'experience', 'education', 'skills', 'projects', 'certifications', 'languages', 'custom',
];

@Component({
  selector: 'vn-section-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CdkDropList, CdkDrag, CdkDragHandle, Icon, ItemEditor],
  styleUrl: './section-list.scss',
  template: `
    <div cdkDropList (cdkDropListDropped)="dropSection($event)" class="sections">
      @for (section of sections(); track section.id) {
        <section class="section" cdkDrag [class.is-hidden]="!section.visible">
          <header class="section-head">
            <button
              class="handle"
              cdkDragHandle
              type="button"
              aria-label="Drag to reorder section"
            >
              <vn-icon name="drag" [size]="16" />
            </button>

            <button
              class="section-toggle"
              type="button"
              [attr.aria-expanded]="isOpen(section.id)"
              (click)="toggleOpen(section.id)"
            >
              <vn-icon [name]="iconFor(section.type)" [size]="16" />
              <span class="section-name">{{ section.title || label(section.type) }}</span>
              <span class="vn-chip count">{{ countLabel(section) }}</span>
              <vn-icon [name]="isOpen(section.id) ? 'chevron-up' : 'chevron-down'" [size]="16" />
            </button>

            <div class="section-tools">
              <button
                class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
                type="button"
                [attr.aria-label]="section.visible ? 'Hide section' : 'Show section'"
                [title]="section.visible ? 'Hide from the resume' : 'Show on the resume'"
                (click)="toggleVisible(section)"
              >
                <vn-icon [name]="section.visible ? 'eye' : 'x'" [size]="15" />
              </button>
              <button
                class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost vn-btn--danger"
                type="button"
                aria-label="Delete section"
                (click)="removeSection(section)"
              >
                <vn-icon name="trash" [size]="15" />
              </button>
            </div>
          </header>

          @if (isOpen(section.id)) {
            <div class="section-body">
              <label class="vn-field">
                <span class="vn-label">Heading</span>
                <input
                  class="vn-input"
                  type="text"
                  [ngModel]="section.title"
                  (ngModelChange)="renameSection(section, $event)"
                  [placeholder]="label(section.type)"
                />
              </label>

              @if (section.type === 'summary') {
                <label class="vn-field">
                  <span class="vn-label">Summary</span>
                  <textarea
                    class="vn-textarea"
                    rows="7"
                    [ngModel]="summaryOf(section).content"
                    (ngModelChange)="setSummary(section, $event)"
                    placeholder="Two or three sentences on who you are and the value you bring…"
                  ></textarea>
                  <span class="vn-hint">Leave a blank line to start a new paragraph.</span>
                </label>
              } @else {
                @for (item of itemsOf(section); track item.id; let i = $index) {
                  <div class="item">
                    <div class="item-head">
                      <span class="item-index">{{ i + 1 }}</span>
                      <button
                        class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost vn-btn--danger"
                        type="button"
                        aria-label="Remove entry"
                        (click)="removeItem(section, item)"
                      >
                        <vn-icon name="trash" [size]="14" />
                      </button>
                    </div>
                    <vn-item-editor
                      [sectionType]="itemSectionType(section)"
                      [item]="item"
                      (itemChange)="updateItem(section, item.id, $event)"
                    />
                  </div>
                }

                <button class="vn-btn vn-btn--sm add-item" type="button" (click)="addItem(section)">
                  <vn-icon name="plus" [size]="15" />
                  Add entry
                </button>
              }
            </div>
          }
        </section>
      }
    </div>

    <div class="add-section">
      <span class="vn-label">Add a section</span>
      <div class="add-row">
        @for (type of addable; track type) {
          <button class="vn-btn vn-btn--sm" type="button" (click)="addSection(type)">
            <vn-icon [name]="iconFor(type)" [size]="14" />
            {{ label(type) }}
          </button>
        }
      </div>
    </div>
  `,
})
export class SectionList {
  private readonly store = inject(ResumeStore);
  private readonly confirm = inject(ConfirmService);

  protected readonly addable = ADDABLE;
  protected readonly sections = computed(() => this.store.resume()?.sections ?? []);

  /** Ids of expanded sections. The first section starts open so the editor is
   *  never a wall of collapsed rows on first load. */
  private readonly open = signal<ReadonlySet<string>>(new Set());
  private seeded = false;

  constructor() {
    // Seeded from an effect rather than lazily from isOpen(): writing a signal
    // while the template is being evaluated aborts the rest of that element's
    // bindings, which silently blanked the first section's name and count.
    effect(() => {
      const sections = this.sections();
      if (this.seeded || sections.length === 0) return;
      this.seeded = true;
      this.open.set(new Set([sections[0].id]));
    });
  }

  protected isOpen(id: string): boolean {
    return this.open().has(id);
  }

  protected toggleOpen(id: string): void {
    this.open.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected label(type: SectionType): string {
    return SECTION_LABELS[type];
  }

  protected iconFor(type: SectionType): IconName {
    return SECTION_ICONS[type] as IconName;
  }

  protected summaryOf(section: ResumeSection): SummarySection {
    return section as SummarySection;
  }

  protected itemsOf(section: ResumeSection): ResumeItem[] {
    return isItemSection(section) ? section.items : [];
  }

  protected itemSectionType(section: ResumeSection): ItemSection['type'] {
    return section.type as ItemSection['type'];
  }

  protected countLabel(section: ResumeSection): string {
    if (section.type === 'summary') {
      const words = section.content.trim().split(/\s+/).filter(Boolean).length;
      return `${words} ${words === 1 ? 'word' : 'words'}`;
    }
    const count = section.items.length;
    return `${count} ${count === 1 ? 'entry' : 'entries'}`;
  }

  protected dropSection(event: CdkDragDrop<unknown>): void {
    const next = [...this.sections()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.store.replaceSections(next);
  }

  protected toggleVisible(section: ResumeSection): void {
    this.store.updateSection(section.id, (current) => ({ ...current, visible: !current.visible }));
  }

  protected renameSection(section: ResumeSection, title: string): void {
    this.store.updateSection(section.id, (current) => ({ ...current, title }));
  }

  protected async removeSection(section: ResumeSection): Promise<void> {
    const name = section.title || this.label(section.type);
    const confirmed = await this.confirm.ask({
      title: `Remove “${name}”?`,
      message: 'The section and every entry in it will be deleted from this resume.',
      confirmLabel: 'Remove section',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.store.replaceSections(this.sections().filter((item) => item.id !== section.id));
  }

  protected setSummary(section: ResumeSection, content: string): void {
    this.store.updateSection(section.id, (current) => ({ ...(current as SummarySection), content }));
  }

  protected addSection(type: SectionType): void {
    const created = emptySection(type);
    this.store.replaceSections([...this.sections(), created]);
    this.open.update((current) => new Set(current).add(created.id));
  }

  protected addItem(section: ResumeSection): void {
    if (!isItemSection(section)) return;
    this.store.updateSection(section.id, (current) => {
      const target = current as ItemSection;
      return { ...target, items: [...target.items, emptyItemFor(target)] } as ResumeSection;
    });
  }

  protected removeItem(section: ResumeSection, item: ResumeItem): void {
    this.store.updateSection(section.id, (current) => {
      const target = current as ItemSection;
      return { ...target, items: target.items.filter((entry) => entry.id !== item.id) } as ResumeSection;
    });
  }

  protected updateItem(section: ResumeSection, itemId: string, next: ResumeItem): void {
    this.store.updateSection(section.id, (current) => {
      const target = current as ItemSection;
      return {
        ...target,
        items: target.items.map((entry) => (entry.id === itemId ? next : entry)),
      } as ResumeSection;
    });
  }
}
