import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CertificationItem,
  CustomItem,
  EducationItem,
  ExperienceItem,
  ItemSection,
  LanguageItem,
  ProjectItem,
  ResumeItem,
  SkillGroupItem,
} from '../../../core/models/resume.model';
import { DateRange, DateRangeValue } from '../fields/date-range';
import { StringList } from '../fields/string-list';

/**
 * The form for a single item, switched on its parent section's type.
 *
 * Keeping all seven shapes in one component means the section list only has to
 * know "render an item" — it never branches on type itself. The casts below are
 * safe because each branch is guarded by the same discriminant.
 */
@Component({
  selector: 'vn-item-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StringList, DateRange],
  template: `
    @switch (sectionType()) {
      @case ('experience') {
        <label class="vn-field">
          <span class="vn-label">Role</span>
          <input class="vn-input" type="text" [ngModel]="experience().role"
                 (ngModelChange)="patch({ role: $event })" placeholder="Lead UI Developer" />
        </label>
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Organisation</span>
            <input class="vn-input" type="text" [ngModel]="experience().organization"
                   (ngModelChange)="patch({ organization: $event })" placeholder="Nexus Cloud Solutions" />
          </label>
          <label class="vn-field">
            <span class="vn-label">Location</span>
            <input class="vn-input" type="text" [ngModel]="experience().location"
                   (ngModelChange)="patch({ location: $event })" placeholder="San Francisco, CA" />
          </label>
        </div>
        <vn-date-range [value]="dateRange()" (valueChange)="patch($event)" />
        <span class="vn-label">Highlights</span>
        <vn-string-list
          [values]="experience().bullets"
          (valuesChange)="patch({ bullets: $event })"
          itemNoun="highlight"
          [multiline]="true"
          placeholder="Spearheaded the redesign of…"
        />
        <span class="vn-label spaced">Technologies</span>
        <vn-string-list
          [values]="experience().tech"
          (valuesChange)="patch({ tech: $event })"
          itemNoun="technology"
          placeholder="TypeScript"
        />
      }

      @case ('education') {
        <label class="vn-field">
          <span class="vn-label">Qualification</span>
          <input class="vn-input" type="text" [ngModel]="education().degree"
                 (ngModelChange)="patch({ degree: $event })" placeholder="B.S. in Computer Science" />
        </label>
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Institution</span>
            <input class="vn-input" type="text" [ngModel]="education().institution"
                   (ngModelChange)="patch({ institution: $event })" placeholder="University of California" />
          </label>
          <label class="vn-field">
            <span class="vn-label">Location</span>
            <input class="vn-input" type="text" [ngModel]="education().location"
                   (ngModelChange)="patch({ location: $event })" placeholder="Berkeley, CA" />
          </label>
        </div>
        <vn-date-range
          [value]="dateRange()"
          (valueChange)="patch($event)"
          currentLabel="I am still studying here"
        />
        <span class="vn-label">Details</span>
        <vn-string-list
          [values]="education().details"
          (valuesChange)="patch({ details: $event })"
          itemNoun="detail"
          placeholder="GPA 3.8/4.0"
        />
      }

      @case ('skills') {
        <label class="vn-field">
          <span class="vn-label">Group</span>
          <input class="vn-input" type="text" [ngModel]="skill().label"
                 (ngModelChange)="patch({ label: $event })" placeholder="Frontend Architecture" />
        </label>
        <span class="vn-label">Skills</span>
        <vn-string-list
          [values]="skill().keywords"
          (valuesChange)="patch({ keywords: $event })"
          itemNoun="skill"
          placeholder="TypeScript"
        />
      }

      @case ('projects') {
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Name</span>
            <input class="vn-input" type="text" [ngModel]="project().name"
                   (ngModelChange)="patch({ name: $event })" placeholder="Pulse Design System" />
          </label>
          <label class="vn-field">
            <span class="vn-label">When</span>
            <input class="vn-input" type="text" [ngModel]="project().period"
                   (ngModelChange)="patch({ period: $event })" placeholder="2023" />
          </label>
        </div>
        <label class="vn-field">
          <span class="vn-label">Link</span>
          <input class="vn-input" type="text" [ngModel]="project().link"
                 (ngModelChange)="patch({ link: $event })" placeholder="github.com/you/project" />
        </label>
        <span class="vn-label">Built with</span>
        <vn-string-list
          [values]="project().tech"
          (valuesChange)="patch({ tech: $event })"
          itemNoun="technology"
          placeholder="React"
        />
        <span class="vn-label spaced">Highlights</span>
        <vn-string-list
          [values]="project().bullets"
          (valuesChange)="patch({ bullets: $event })"
          itemNoun="highlight"
          [multiline]="true"
          placeholder="Created an open-source UI system with…"
        />
      }

      @case ('certifications') {
        <label class="vn-field">
          <span class="vn-label">Certification</span>
          <input class="vn-input" type="text" [ngModel]="certification().name"
                 (ngModelChange)="patch({ name: $event })" placeholder="AWS Certified Developer" />
        </label>
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Issuer</span>
            <input class="vn-input" type="text" [ngModel]="certification().issuer"
                   (ngModelChange)="patch({ issuer: $event })" placeholder="Amazon Web Services" />
          </label>
          <label class="vn-field">
            <span class="vn-label">Date</span>
            <input class="vn-input" type="text" [ngModel]="certification().date"
                   (ngModelChange)="patch({ date: $event })" placeholder="2024" />
          </label>
        </div>
        <label class="vn-field">
          <span class="vn-label">Note</span>
          <input class="vn-input" type="text" [ngModel]="certification().note"
                 (ngModelChange)="patch({ note: $event })" placeholder="Associate level" />
        </label>
      }

      @case ('languages') {
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Language</span>
            <input class="vn-input" type="text" [ngModel]="language().name"
                   (ngModelChange)="patch({ name: $event })" placeholder="Spanish" />
          </label>
          <label class="vn-field">
            <span class="vn-label">Proficiency</span>
            <input class="vn-input" type="text" [ngModel]="language().level"
                   (ngModelChange)="patch({ level: $event })" placeholder="Professional working" />
          </label>
        </div>
      }

      @case ('custom') {
        <div class="pair">
          <label class="vn-field">
            <span class="vn-label">Title</span>
            <input class="vn-input" type="text" [ngModel]="custom().title"
                   (ngModelChange)="patch({ title: $event })" placeholder="Volunteer lead" />
          </label>
          <label class="vn-field">
            <span class="vn-label">Meta</span>
            <input class="vn-input" type="text" [ngModel]="custom().meta"
                   (ngModelChange)="patch({ meta: $event })" placeholder="2021 — 2023" />
          </label>
        </div>
        <label class="vn-field">
          <span class="vn-label">Subtitle</span>
          <input class="vn-input" type="text" [ngModel]="custom().subtitle"
                 (ngModelChange)="patch({ subtitle: $event })" placeholder="Code for Good" />
        </label>
        <span class="vn-label">Details</span>
        <vn-string-list
          [values]="custom().bullets"
          (valuesChange)="patch({ bullets: $event })"
          itemNoun="detail"
          [multiline]="true"
        />
      }
    }
  `,
  styles: `
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .vn-label.spaced { margin-top: 12px; }
  `,
})
export class ItemEditor {
  readonly sectionType = input.required<ItemSection['type']>();
  readonly item = input.required<ResumeItem>();

  readonly itemChange = output<ResumeItem>();

  protected readonly experience = computed(() => this.item() as ExperienceItem);
  protected readonly education = computed(() => this.item() as EducationItem);
  protected readonly skill = computed(() => this.item() as SkillGroupItem);
  protected readonly project = computed(() => this.item() as ProjectItem);
  protected readonly certification = computed(() => this.item() as CertificationItem);
  protected readonly language = computed(() => this.item() as LanguageItem);
  protected readonly custom = computed(() => this.item() as CustomItem);

  protected readonly dateRange = computed<DateRangeValue>(() => {
    const item = this.item() as ExperienceItem;
    return { start: item.start ?? '', end: item.end ?? '', current: item.current ?? false };
  });

  protected patch(changes: Partial<Record<string, unknown>> | DateRangeValue): void {
    this.itemChange.emit({ ...this.item(), ...changes } as ResumeItem);
  }
}
