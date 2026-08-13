import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { CustomTemplateApi } from '../../core/api/custom-template.api';
import { TemplateApi } from '../../core/api/resume.api';
import { isCustomTemplateId } from '../../core/models/custom-template.model';

/** Width of an A4 page in CSS pixels at 96dpi — the width the iframe renders at. */
const PAGE_WIDTH_PX = 794;

/**
 * A live thumbnail of a design, rendered with demo content.
 *
 * The document is dropped into a sandboxed iframe via `srcdoc` and then scaled
 * down with a CSS transform, so the card shows the genuine output rather than a
 * screenshot that could fall out of date whenever a template changes.
 */
@Component({
  selector: 'vn-template-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (html(); as doc) {
      <iframe
        class="frame"
        [srcdoc]="doc"
        sandbox=""
        loading="lazy"
        tabindex="-1"
        title="Template preview"
      ></iframe>
    } @else {
      <div class="frame-placeholder"></div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      /* A rendered resume is printed matter: white in both app themes. */
      background: var(--vn-paper);
      color-scheme: light;
    }

    /* Rendered at full A4 width, then scaled to fit the card. Scaling rather than
       resizing keeps the type proportions identical to the real page. The scale
       is measured from the host, never assumed — a hardcoded value clipped the
       right-hand side of every page whenever the card was narrower than guessed. */
    .frame {
      position: absolute;
      top: 0;
      left: 0;
      width: 794px;
      height: 1123px;
      border: 0;
      transform: scale(var(--vn-thumb-scale, 0.3));
      transform-origin: top left;
      pointer-events: none;
      background: var(--vn-paper);
    }

    .frame-placeholder {
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, var(--vn-paper), var(--vn-paper-gutter));
    }
  `,
})
export class TemplatePreview implements OnDestroy {
  private readonly api = inject(TemplateApi);
  private readonly customApi = inject(CustomTemplateApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly templateId = input.required<string>();

  protected readonly html = signal<SafeHtml | null>(null);

  private readonly resize = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width > 0) {
      this.host.nativeElement.style.setProperty(
        '--vn-thumb-scale',
        String(width / PAGE_WIDTH_PX),
      );
    }
  });

  constructor() {
    this.resize.observe(this.host.nativeElement);

    // A `custom:<id>` design is a document rather than a folder on disk, so it
    // is sampled through its own endpoint — which is authenticated, since a
    // design belongs to one account.
    toObservable(this.templateId)
      .pipe(
        switchMap((id) =>
          isCustomTemplateId(id)
            ? this.customApi.sampleHtml(id.replace(/^custom:/, ''))
            : this.api.sampleHtml(id),
        ),
      )
      .subscribe({
        // The document comes from our own render endpoint and the iframe is fully
        // sandboxed (no scripts, no same-origin), so bypassing here is safe.
        next: (doc) => this.html.set(this.sanitizer.bypassSecurityTrustHtml(doc)),
        error: () => this.html.set(null),
      });
  }

  ngOnDestroy(): void {
    this.resize.disconnect();
  }
}
