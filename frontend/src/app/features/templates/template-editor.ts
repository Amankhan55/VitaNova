import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, filter, of, switchMap, tap } from 'rxjs';

import { CustomTemplateApi } from '../../core/api/custom-template.api';
import { ResumeApi } from '../../core/api/resume.api';
import {
  CustomTemplate,
  CustomTemplateSpec,
  DEFAULT_SPEC,
  SPEC_PALETTES,
} from '../../core/models/custom-template.model';
import { SECTION_LABELS, SectionType, Theme } from '../../core/models/resume.model';
import { ConfirmService } from '../../shared/ui/confirm/confirm.service';
import { Icon } from '../../shared/ui/icon/icon';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** When a control applies. `sidebar` controls are meaningless in one column. */
type Condition = 'always' | 'sidebar' | 'no-banner';

interface EnumControl {
  kind: 'enum';
  field: keyof CustomTemplateSpec;
  label: string;
  options: { value: string; label: string }[];
  when?: Condition;
}

interface SliderControl {
  kind: 'slider';
  field: keyof CustomTemplateSpec;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  when?: Condition;
}

interface ToggleControl {
  kind: 'toggle';
  field: keyof CustomTemplateSpec;
  label: string;
  when?: Condition;
}

interface ColourControl {
  kind: 'colour';
  field: keyof CustomTemplateSpec;
  label: string;
  when?: Condition;
}

interface SectionsControl {
  kind: 'sections';
  field: 'sidebar_sections';
  label: string;
  when?: Condition;
}

type Control = EnumControl | SliderControl | ToggleControl | ColourControl | SectionsControl;

const SIDEBAR_CANDIDATES: SectionType[] = [
  'skills',
  'languages',
  'certifications',
  'education',
  'projects',
  'custom',
];

/**
 * Every control the builder offers, as data.
 *
 * Written this way rather than as forty hand-laid form rows because the spec is
 * itself a closed list of decisions: a new field in `CustomTemplateSpec` becomes
 * a working control by adding one line here, and the template that renders these
 * stays short enough to read in one screen.
 */
const GROUPS: { id: string; label: string; controls: Control[] }[] = [
  {
    id: 'layout',
    label: 'Layout',
    controls: [
      {
        kind: 'enum', field: 'layout', label: 'Columns',
        options: [
          { value: 'single', label: 'One' },
          { value: 'sidebar-left', label: 'Sidebar left' },
          { value: 'sidebar-right', label: 'Sidebar right' },
        ],
      },
      {
        kind: 'enum', field: 'sidebar_tone', label: 'Sidebar treatment', when: 'sidebar',
        options: [
          { value: 'fill', label: 'Filled' },
          { value: 'accent', label: 'Accent' },
          { value: 'plain', label: 'Ruled' },
        ],
      },
      {
        kind: 'slider', field: 'sidebar_width', label: 'Sidebar width',
        min: 24, max: 44, step: 1, unit: '%', when: 'sidebar',
      },
      {
        kind: 'sections', field: 'sidebar_sections',
        label: 'Sections in the sidebar', when: 'sidebar',
      },
      {
        kind: 'toggle', field: 'contacts_in_sidebar',
        label: 'Contact details in the sidebar', when: 'sidebar',
      },
    ],
  },
  {
    id: 'header',
    label: 'Header',
    controls: [
      {
        kind: 'enum', field: 'header_style', label: 'Arrangement',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'centered', label: 'Centred' },
          { value: 'split', label: 'Split' },
          { value: 'banner', label: 'Banner' },
        ],
      },
      {
        kind: 'enum', field: 'name_case', label: 'Name',
        options: [
          { value: 'normal', label: 'As typed' },
          { value: 'upper', label: 'Capitals' },
        ],
      },
      { kind: 'toggle', field: 'show_headline', label: 'Show the headline' },
      { kind: 'toggle', field: 'show_monogram', label: 'Show initials' },
      { kind: 'toggle', field: 'header_rule', label: 'Rule under the header', when: 'no-banner' },
    ],
  },
  {
    id: 'headings',
    label: 'Section headings',
    controls: [
      {
        kind: 'enum', field: 'heading_style', label: 'Treatment',
        options: [
          { value: 'plain', label: 'Plain' },
          { value: 'underline', label: 'Underlined' },
          { value: 'rule', label: 'Ruled above' },
          { value: 'band', label: 'Band' },
          { value: 'bar', label: 'Side bar' },
          { value: 'boxed', label: 'Boxed' },
        ],
      },
      {
        kind: 'enum', field: 'heading_case', label: 'Case',
        options: [
          { value: 'upper', label: 'Capitals' },
          { value: 'normal', label: 'As typed' },
        ],
      },
      {
        kind: 'enum', field: 'heading_align', label: 'Alignment',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centred' },
        ],
      },
      { kind: 'toggle', field: 'heading_accent', label: 'Use the accent colour' },
      {
        kind: 'slider', field: 'heading_tracking', label: 'Letter spacing',
        min: 0, max: 0.24, step: 0.01, unit: 'em',
      },
    ],
  },
  {
    id: 'type',
    label: 'Type',
    controls: [
      {
        kind: 'enum', field: 'body_font', label: 'Body face',
        options: [
          { value: 'sans', label: 'Sans' },
          { value: 'grotesk', label: 'Grotesk' },
          { value: 'serif', label: 'Serif' },
          { value: 'book', label: 'Book' },
          { value: 'mono', label: 'Mono' },
        ],
      },
      {
        kind: 'enum', field: 'heading_font', label: 'Heading face',
        options: [
          { value: 'sans', label: 'Sans' },
          { value: 'grotesk', label: 'Grotesk' },
          { value: 'serif', label: 'Serif' },
          { value: 'book', label: 'Book' },
          { value: 'mono', label: 'Mono' },
        ],
      },
      { kind: 'slider', field: 'name_size_pt', label: 'Name', min: 15, max: 34, step: 0.5, unit: 'pt' },
      { kind: 'slider', field: 'heading_size_pt', label: 'Headings', min: 8.5, max: 16, step: 0.5, unit: 'pt' },
      { kind: 'slider', field: 'body_size_pt', label: 'Body', min: 8.5, max: 12, step: 0.1, unit: 'pt' },
      { kind: 'slider', field: 'line_height', label: 'Leading', min: 1.15, max: 1.8, step: 0.01, unit: '' },
    ],
  },
  {
    id: 'detail',
    label: 'Detail',
    controls: [
      {
        kind: 'enum', field: 'bullet_style', label: 'Bullets',
        options: [
          { value: 'disc', label: 'Disc' },
          { value: 'square', label: 'Square' },
          { value: 'dash', label: 'Dash' },
          { value: 'none', label: 'None' },
        ],
      },
      {
        kind: 'enum', field: 'tag_style', label: 'Skills & tech',
        options: [
          { value: 'inline', label: 'Inline' },
          { value: 'pill', label: 'Pills' },
          { value: 'bracket', label: 'Bracketed' },
        ],
      },
      {
        kind: 'enum', field: 'entry_divider', label: 'Between entries',
        options: [
          { value: 'none', label: 'Space' },
          { value: 'hairline', label: 'Hairline' },
          { value: 'dotted', label: 'Dotted' },
        ],
      },
      { kind: 'slider', field: 'rule_weight_pt', label: 'Rule weight', min: 0.3, max: 3, step: 0.1, unit: 'pt' },
    ],
  },
  {
    id: 'page',
    label: 'Page',
    controls: [
      { kind: 'slider', field: 'page_margin_mm', label: 'Margin', min: 6, max: 25, step: 0.5, unit: 'mm' },
      { kind: 'slider', field: 'section_gap_px', label: 'Between sections', min: 4, max: 26, step: 1, unit: 'px' },
      { kind: 'slider', field: 'entry_gap_px', label: 'Between entries', min: 2, max: 20, step: 1, unit: 'px' },
    ],
  },
  {
    id: 'colour',
    label: 'Colour',
    controls: [
      { kind: 'colour', field: 'ink', label: 'Headings' },
      { kind: 'colour', field: 'body_colour', label: 'Body text' },
      { kind: 'colour', field: 'muted_colour', label: 'Secondary text' },
      { kind: 'colour', field: 'paper', label: 'Paper' },
      { kind: 'colour', field: 'sidebar_bg', label: 'Sidebar fill', when: 'sidebar' },
      { kind: 'colour', field: 'sidebar_text', label: 'Sidebar text', when: 'sidebar' },
    ],
  },
];

@Component({
  selector: 'vn-template-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon],
  styleUrl: './template-editor.scss',
  templateUrl: './template-editor.html',
})
export class TemplateEditorPage {
  private readonly api = inject(CustomTemplateApi);
  private readonly resumeApi = inject(ResumeApi);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly confirm = inject(ConfirmService);

  /** Bound from the `:id` route parameter via `withComponentInputBinding()`.
   *  The literal 'new' means "this design has not been saved yet". */
  readonly id = input.required<string>();

  protected readonly groups = GROUPS;
  protected readonly palettes = SPEC_PALETTES;
  protected readonly sectionCandidates = SIDEBAR_CANDIDATES;
  protected readonly sectionLabels = SECTION_LABELS;
  protected readonly accentPresets = [
    '#2563EB', '#0F766E', '#B45309', '#9333EA', '#BE123C', '#334155',
  ];

  protected readonly name = signal('My design');
  protected readonly description = signal('');
  protected readonly accent = signal('#2563EB');
  protected readonly spec = signal<CustomTemplateSpec>({ ...DEFAULT_SPEC });
  protected readonly theme = signal<Theme>({
    accent: '#2563EB', font_scale: 1, page_size: 'A4', density: 'normal',
  });

  protected readonly status = signal<SaveStatus>('idle');
  protected readonly previewHtml = signal<SafeHtml | null>(null);
  protected readonly previewPending = signal(false);
  protected readonly loadError = signal('');
  protected readonly busy = signal('');
  protected readonly openGroup = signal('layout');

  protected readonly saved = computed(() => this.id() !== '' && this.id() !== 'new');
  protected readonly atsSafe = computed(() => this.spec().layout === 'single');

  /** Guards against autosaving the copy just fetched from the server. */
  private dirty = false;

  /** The id `save()` just created, so the route change it triggers does not
   *  reload over what is already on screen. */
  private createdId = '';

  /** Everything the preview and the save both read, so the two never disagree. */
  private readonly draft = computed(() => ({
    name: this.name(),
    description: this.description(),
    accent: this.accent(),
    spec: this.spec(),
    // The accent lives on the theme at render time — that is where a resume
    // carries it — so the design's own accent is folded in here rather than
    // being a second, competing source of the same colour.
    theme: { ...this.theme(), accent: this.accent() },
  }));

  constructor() {
    effect(() => {
      const id = this.id();
      // `save()` navigates from /new onto the real id, which re-fires this. The
      // state on screen is already the design that was just written, and one
      // edit may have landed since — refetching it would only overwrite that.
      if (id && id !== 'new' && id !== this.createdId) this.load(id);
    });

    const changes = toObservable(this.draft);

    changes
      .pipe(
        tap(() => this.previewPending.set(true)),
        debounceTime(220),
        // A failed render resolves to null rather than being swallowed: dropping
        // it would leave the pane dimmed under a permanent "Updating" badge with
        // nothing ever arriving to clear it.
        switchMap((draft) =>
          this.api.preview(draft.spec, draft.theme).pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((html) => {
        this.previewPending.set(false);
        // Our own render endpoint, shown in a fully sandboxed iframe.
        if (html !== null) this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
      });

    // Autosave, but only once the design exists. A brand-new one is saved by the
    // explicit button instead: silently creating a document because somebody
    // dragged a slider on a page they were only looking at is not a kindness.
    changes
      .pipe(
        filter(() => this.dirty && this.saved()),
        tap(() => this.status.set('saving')),
        debounceTime(700),
        switchMap((draft) =>
          this.api.update(this.id(), draft).pipe(
            switchMap(() => of<SaveStatus>('saved')),
            catchError(() => of<SaveStatus>('error')),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((status) => this.status.set(status));
  }

  private load(id: string): void {
    this.dirty = false;
    this.loadError.set('');
    this.api.get(id).subscribe({
      next: (design) => this.adopt(design),
      error: () => this.loadError.set('That design could not be loaded.'),
    });
  }

  private adopt(design: CustomTemplate): void {
    this.dirty = false;
    this.name.set(design.name);
    this.description.set(design.description);
    this.accent.set(design.accent);
    this.theme.set(design.theme);
    // Spread over the defaults so a document written before a field existed
    // still fills every control rather than leaving one blank.
    this.spec.set({ ...DEFAULT_SPEC, ...design.spec });
  }

  // ------------------------------------------------------------------ editing

  protected value(field: keyof CustomTemplateSpec): string | number | boolean {
    return this.spec()[field] as string | number | boolean;
  }

  protected set(field: keyof CustomTemplateSpec, value: unknown): void {
    this.dirty = true;
    this.spec.update((spec) => ({ ...spec, [field]: value }));
  }

  protected setNumber(field: keyof CustomTemplateSpec, value: string | number): void {
    this.set(field, +value);
  }

  protected rename(name: string): void {
    this.dirty = true;
    this.name.set(name);
  }

  protected describe(description: string): void {
    this.dirty = true;
    this.description.set(description);
  }

  protected recolour(accent: string): void {
    this.dirty = true;
    this.accent.set(accent);
  }

  protected applyPalette(colours: Partial<CustomTemplateSpec>): void {
    this.dirty = true;
    this.spec.update((spec) => ({ ...spec, ...colours }));
  }

  protected toggleSidebarSection(type: SectionType): void {
    const current = this.spec().sidebar_sections;
    this.set(
      'sidebar_sections',
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type],
    );
  }

  protected inSidebar(type: SectionType): boolean {
    return this.spec().sidebar_sections.includes(type);
  }

  /** Whether a control applies to the design as it currently stands. */
  protected applies(control: Control): boolean {
    if (control.when === 'sidebar') return this.spec().layout !== 'single';
    if (control.when === 'no-banner') return this.spec().header_style !== 'banner';
    return true;
  }

  protected shown(controls: Control[]): Control[] {
    return controls.filter((control) => this.applies(control));
  }

  /** Sliders read in their own unit; a bare 1.42 next to "Leading" says nothing. */
  protected reading(control: SliderControl): string {
    const raw = Number(this.value(control.field));
    const decimals = control.step < 0.1 ? 2 : control.step < 1 ? 1 : 0;
    return `${raw.toFixed(decimals)}${control.unit}`;
  }

  // ------------------------------------------------------------------ actions

  protected save(): void {
    if (this.saved() || this.busy()) return;
    this.busy.set('save');
    this.status.set('saving');
    // Cleared before the request, not after: an edit made while it is in flight
    // then marks the design dirty again, so the check below can see it.
    this.dirty = false;
    this.api.create(this.draft()).subscribe({
      next: (design) => {
        this.busy.set('');
        this.createdId = design.id;
        // Replaces the /new URL so a refresh — or the browser's back button —
        // lands on the design that now exists rather than on a blank one.
        void this.router.navigate(['/templates/custom', design.id], { replaceUrl: true });

        // Anything typed during the create is not in what was just sent, and the
        // autosave stream was still filtered off by `saved()` when that change
        // went past it. Send it now rather than losing it.
        if (!this.dirty) {
          this.status.set('saved');
          return;
        }
        this.api.update(design.id, this.draft()).subscribe({
          next: () => this.status.set('saved'),
          error: () => this.status.set('error'),
        });
      },
      error: () => {
        this.busy.set('');
        this.status.set('error');
        this.loadError.set('That design could not be saved. Please try again.');
      },
    });
  }

  protected duplicate(): void {
    if (!this.saved() || this.busy()) return;
    this.busy.set('duplicate');
    this.api.duplicate(this.id()).subscribe({
      next: (design) => {
        this.busy.set('');
        void this.router.navigate(['/templates/custom', design.id]);
      },
      error: () => this.busy.set(''),
    });
  }

  protected async remove(): Promise<void> {
    if (!this.saved() || this.busy()) return;
    const ok = await this.confirm.ask({
      title: `Delete “${this.name()}”?`,
      // Deleting a design restyles every resume set in it, which is not obvious
      // from the button and is not something to discover afterwards.
      message:
        'Any resume using this design will be moved to Modern Professional. ' +
        'This cannot be undone.',
      confirmLabel: 'Delete design',
      tone: 'danger',
    });
    if (!ok) return;

    this.busy.set('delete');
    this.api.remove(this.id()).subscribe({
      next: () => void this.router.navigate(['/templates']),
      error: () => this.busy.set(''),
    });
  }

  /** Creates a resume set in this design and opens it. */
  protected useDesign(): void {
    if (!this.saved() || this.busy()) return;
    this.busy.set('use');
    this.resumeApi
      .create({
        title: `${this.name()} resume`,
        template_id: `custom:${this.id()}`,
        seed_from_template: true,
      })
      .subscribe({
        next: (resume) => void this.router.navigate(['/editor', resume.id]),
        error: () => {
          this.busy.set('');
          this.loadError.set('Could not create the resume. Please try again.');
        },
      });
  }
}
