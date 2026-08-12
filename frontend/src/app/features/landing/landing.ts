import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TemplateApi } from '../../core/api/resume.api';
import { AuthService } from '../../core/auth/auth.service';
import { TemplateMeta } from '../../core/models/auth.model';
import { Icon } from '../../shared/ui/icon/icon';
import { IconName } from '../../shared/ui/icon/icons';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { TemplatePreview } from '../templates/template-preview';

/**
 * Where "Contact us" points. Leave a handle empty and its card is not rendered
 * at all — better a short list than a link to a profile that does not exist.
 *
 * `email` is the one field that is never printed on the page: the contact form
 * hands it to the visitor's own mail client, and nothing renders it as text.
 * It still ships to the browser inside the bundle, so treat it as unlisted
 * rather than as private — anyone reading the source can still find it.
 */
const CONTACT = {
  email: 'amann.khan58@gmail.com',
  github: '',
  linkedin: '',
  location: 'Remote — replies within a day or two',
};

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: 'eye',
    title: 'The preview is the PDF',
    body:
      'Both come from one rendered document. Not a lookalike, not a re-implementation — the same bytes, so nothing shifts between the screen and the file you send.',
  },
  {
    icon: 'layers',
    title: 'Nine designs, one draft',
    body:
      'Content is stored apart from its presentation. Switch from a strict ATS layout to a bold sidebar and not a single word is retyped.',
  },
  {
    icon: 'shield',
    title: 'Parser-safe by default',
    body:
      'The ATS-marked designs stay inside the plain structure applicant tracking systems can actually read, so your experience survives the upload.',
  },
  {
    icon: 'palette',
    title: 'Tuned, not templated',
    body:
      'Accent colour, page size, spacing density and text scale are yours to set. The typography stays proportional at every setting.',
  },
  {
    icon: 'save',
    title: 'Saves as you think',
    body:
      'Autosave runs on its own clock, well behind the preview, so a slow write never stalls the page you are looking at.',
  },
  {
    icon: 'download',
    title: 'Print-ready export',
    body:
      'Real page margins, sensible page breaks, and headings that are never stranded at the foot of a page. One click, one PDF.',
  },
];

interface Step {
  number: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Pick a design',
    body: 'Every card in the gallery is a live render, not a screenshot. What you see is what the engine produces.',
  },
  {
    number: '02',
    title: 'Write it once',
    body: 'Add, rename, reorder or hide any section. Drag them into the order that tells your story best.',
  },
  {
    number: '03',
    title: 'Export and send',
    body: 'Download a print-ready PDF. Come back tomorrow, switch designs, and export again in seconds.',
  },
];

@Component({
  selector: 'vn-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo, ThemeToggle, TemplatePreview],
  styleUrl: './landing.scss',
  template: `
    <a class="skip" href="#main">Skip to content</a>

    <!-- ============================================================ nav -->
    <header class="nav" [class.is-stuck]="scrolled()">
      <a class="nav-brand" routerLink="/" aria-label="VitaNova home">
        <vn-logo [size]="28" />
        <span>Vita<strong>Nova</strong></span>
      </a>

      <nav class="nav-links" aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#designs">Designs</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>

      <div class="nav-actions">
        <vn-theme-toggle [compact]="true" />
        @if (signedIn()) {
          <a class="vn-btn vn-btn--primary" routerLink="/dashboard">
            Open dashboard
            <vn-icon name="arrow-right" [size]="16" />
          </a>
        } @else {
          <a class="vn-btn nav-signin" routerLink="/login">Log in</a>
          <a class="vn-btn vn-btn--primary" routerLink="/register">Register</a>
        }

        <button
          type="button"
          class="nav-burger"
          [attr.aria-expanded]="navOpen()"
          aria-label="Open menu"
          (click)="toggleNav($event)"
        >
          <vn-icon [name]="navOpen() ? 'x' : 'menu'" [size]="20" />
        </button>
      </div>

      @if (navOpen()) {
        <div class="nav-sheet">
          <a href="#how">How it works</a>
          <a href="#designs">Designs</a>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
          <div class="nav-sheet-actions">
            @if (signedIn()) {
              <a class="vn-btn vn-btn--primary vn-btn--block" routerLink="/dashboard">Open dashboard</a>
            } @else {
              <a class="vn-btn vn-btn--block" routerLink="/login">Log in</a>
              <a class="vn-btn vn-btn--primary vn-btn--block" routerLink="/register">Register</a>
            }
          </div>
        </div>
      }
    </header>

    <main id="main">
      <!-- ======================================================== hero -->
      <!-- Set as the front page of a broadsheet: a dateline, then the headline
           running the full measure, then the story and the plate beneath it. -->
      <section class="hero">
        <div class="dateline">
          <span>VitaNova</span>
          <span>Nine designs</span>
          <span>One source of truth</span>
          <span class="dateline-end">Free to use</span>
        </div>

        <h1>Your career, <em>beautifully</em> set.</h1>

        <div class="hero-body">
          <div class="hero-copy">
            <p class="lede">
              VitaNova is a resume builder that refuses to lie to you. The page in the editor and
              the PDF in your downloads folder are the very same document — so what you approve is
              exactly what an employer opens.
            </p>

            <div class="hero-cta">
              @if (signedIn()) {
                <a class="vn-btn vn-btn--primary vn-btn--lg" routerLink="/dashboard">
                  Open your dashboard
                  <vn-icon name="arrow-right" [size]="16" />
                </a>
                <a class="vn-btn vn-btn--lg" routerLink="/templates">Browse designs</a>
              } @else {
                <a class="vn-btn vn-btn--primary vn-btn--lg" routerLink="/register">
                  Register — it's free
                  <vn-icon name="arrow-right" [size]="16" />
                </a>
                <a class="vn-btn vn-btn--lg" routerLink="/login">Log in</a>
              }
            </div>

            <ul class="hero-points">
              <li><vn-icon name="check" [size]="15" /> No credit card, no trial clock</li>
              <li><vn-icon name="check" [size]="15" /> Export as often as you like</li>
              <li><vn-icon name="check" [size]="15" /> Your draft is yours alone</li>
            </ul>
          </div>

          <!-- Real renders from the template API — the same endpoint the gallery
               uses, so this stage can never show a design that no longer exists. -->
          <div class="hero-stage" aria-hidden="true">
            @for (meta of heroTemplates(); track meta.id; let i = $index) {
              <div class="stage-sheet vn-paper-sheet" [class]="'stage-sheet--' + i">
                <vn-template-preview [templateId]="meta.id" />
              </div>
            }
            @if (heroTemplates().length === 0) {
              <div class="stage-sheet stage-sheet--0 vn-paper-sheet"></div>
            }
          </div>
        </div>
      </section>

      <!-- ==================================================== how it works -->
      <section class="section" id="how">
        <header class="section-head">
          <span class="vn-eyebrow">How it works</span>
          <h2>Three steps, and you are done</h2>
          <p>
            No wizard to sit through and nothing to learn. Pick, write, export — and change your mind
            as often as you want.
          </p>
        </header>

        <ol class="steps">
          @for (step of steps; track step.number) {
            <li class="step">
              <span class="step-number vn-mono">{{ step.number }}</span>
              <h3>{{ step.title }}</h3>
              <p>{{ step.body }}</p>
            </li>
          }
        </ol>
      </section>

      <!-- ===================================================== features -->
      <section class="section" id="features">
        <header class="section-head">
          <span class="vn-eyebrow">Why it is built this way</span>
          <h2>Small product, uncompromising details</h2>
          <p>
            Most builders draw the preview with one renderer and the PDF with another, and the two
            quietly drift apart. VitaNova makes that impossible by construction.
          </p>
        </header>

        <div class="features">
          @for (feature of features; track feature.title) {
            <article class="feature">
              <span class="feature-icon"><vn-icon [name]="feature.icon" [size]="18" /></span>
              <h3>{{ feature.title }}</h3>
              <p>{{ feature.body }}</p>
            </article>
          }
        </div>
      </section>

      <!-- ====================================================== designs -->
      <section class="section" id="designs">
        <header class="section-head">
          <span class="vn-eyebrow">The gallery</span>
          <h2>Live renders, not screenshots</h2>
          <p>
            Each sheet below was produced a moment ago by the same engine that writes your PDF. The
            paper stays white whichever theme you are reading this in — because that is what prints.
          </p>
        </header>

        @if (templatesError()) {
          <p class="notice">
            <vn-icon name="x" [size]="17" />
            {{ templatesError() }}
          </p>
        }

        <div class="designs">
          @for (meta of galleryTemplates(); track meta.id) {
            <figure class="design">
              <div class="design-mount vn-paper-gutter">
                <div class="design-paper vn-paper-sheet">
                  <vn-template-preview [templateId]="meta.id" />
                </div>
              </div>
              <figcaption>
                <span class="design-name">{{ meta.name }}</span>
                @if (meta.ats_safe) {
                  <span class="vn-chip vn-chip--accent">
                    <vn-icon name="check" [size]="11" />
                    ATS safe
                  </span>
                }
              </figcaption>
            </figure>
          } @empty {
            @if (!templatesError()) {
              @for (n of [0, 1, 2, 3]; track n) {
                <div class="design">
                  <div class="design-mount vn-skeleton"></div>
                </div>
              }
            }
          }
        </div>

        <p class="designs-foot">
          <a routerLink="/register">Create an account</a> to open the full gallery — every design,
          rendered with your own words.
        </p>
      </section>

      <!-- ======================================================== about -->
      <section class="section about" id="about">
        <!-- A colophon: what the thing is made of, set the way a book records
             its own typesetting on the last page. -->
        <aside class="about-aside">
          <span class="colophon-title">Colophon</span>
          <p class="colophon-note">
            Rendered by WeasyPrint from Jinja templates, served by FastAPI, edited in Angular.
          </p>
          <div class="about-stack">
            @for (item of stack; track item) {
              <span class="vn-chip">{{ item }}</span>
            }
          </div>
        </aside>

        <div class="about-copy">
          <span class="vn-eyebrow">About the project</span>
          <h2>Built to end an old, familiar surprise.</h2>
          <p>
            Anyone who has written a resume at midnight knows the moment: a builder's tidy preview
            turns into a PDF with a heading orphaned at the foot of page one. The preview had never
            been the document. It was a drawing of one.
          </p>
          <p>
            VitaNova starts from the opposite end. A single Jinja template and stylesheet produce
            one self-contained HTML document; the editor shows it in an iframe and WeasyPrint turns
            the same bytes into a PDF. A test in the repository asserts the two endpoints return
            identical output — if they ever diverge, the build fails rather than your application.
          </p>
          <p>
            The trade-off is real and deliberate: templates are written in the CSS subset both
            engines agree on. No grid, no exotic flexbox. Columns are tables, right-aligned dates
            are floats. Slightly old-fashioned, entirely predictable.
          </p>

          <dl class="about-facts">
            <div class="fact">
              <dt class="fact-value">9</dt>
              <dd class="fact-label">designs, all live-rendered</dd>
            </div>
            <div class="fact">
              <dt class="fact-value">1</dt>
              <dd class="fact-label">document behind preview &amp; PDF</dd>
            </div>
            <div class="fact">
              <dt class="fact-value">0</dt>
              <dd class="fact-label">words retyped when you switch</dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- ====================================================== contact -->
      <section class="section contact" id="contact">
        <div class="contact-copy">
          <span class="vn-eyebrow">Contact us</span>
          <h2>Something broken, or missing?</h2>
          <p>
            Bug reports, a design you wish existed, or a layout your ATS mangled — all of it is
            welcome. Write a line below and your mail client opens with it ready to send.
          </p>

          <div class="contact-cards">
            <!-- The address itself is deliberately not printed here; the form
                 alongside is the way in. See the CONTACT constant. -->
            <div class="contact-card is-static">
              <span class="contact-icon"><vn-icon name="mail" [size]="18" /></span>
              <span class="contact-text">
                <span class="contact-label">Email</span>
                <span class="contact-value">Use the form — it composes the message for you</span>
              </span>
            </div>

            @if (contact.github) {
              <a class="contact-card" [href]="contact.github" target="_blank" rel="noreferrer">
                <span class="contact-icon"><vn-icon name="github" [size]="18" /></span>
                <span class="contact-text">
                  <span class="contact-label">GitHub</span>
                  <span class="contact-value">Source &amp; issues</span>
                </span>
              </a>
            }

            @if (contact.linkedin) {
              <a class="contact-card" [href]="contact.linkedin" target="_blank" rel="noreferrer">
                <span class="contact-icon"><vn-icon name="linkedin" [size]="18" /></span>
                <span class="contact-text">
                  <span class="contact-label">LinkedIn</span>
                  <span class="contact-value">Say hello</span>
                </span>
              </a>
            }

            <div class="contact-card is-static">
              <span class="contact-icon"><vn-icon name="clock" [size]="18" /></span>
              <span class="contact-text">
                <span class="contact-label">Response time</span>
                <span class="contact-value">{{ contact.location }}</span>
              </span>
            </div>
          </div>
        </div>

        <form class="contact-form" (ngSubmit)="sendMessage()" #form="ngForm" novalidate>
          <h3>Send a message</h3>

          <div class="pair">
            <label class="vn-field">
              <span class="vn-label">Your name</span>
              <input
                class="vn-input"
                type="text"
                name="name"
                autocomplete="name"
                required
                [(ngModel)]="name"
                placeholder="Alex Morgan"
              />
            </label>

            <label class="vn-field">
              <span class="vn-label">Your email</span>
              <input
                class="vn-input"
                type="email"
                name="email"
                autocomplete="email"
                required
                [(ngModel)]="email"
                placeholder="you@example.com"
              />
            </label>
          </div>

          <label class="vn-field">
            <span class="vn-label">Subject</span>
            <input
              class="vn-input"
              type="text"
              name="subject"
              [(ngModel)]="subject"
              placeholder="A design idea"
            />
          </label>

          <label class="vn-field">
            <span class="vn-label">Message</span>
            <textarea
              class="vn-textarea"
              rows="5"
              name="message"
              required
              [(ngModel)]="message"
              placeholder="Tell us what happened, or what you wish VitaNova did…"
            ></textarea>
          </label>

          <button class="vn-btn vn-btn--primary vn-btn--block" type="submit" [disabled]="form.invalid">
            <vn-icon name="send" [size]="16" />
            Open in my mail app
          </button>

          <p class="contact-note">
            <vn-icon name="shield" [size]="14" />
            Nothing is posted to a server — the button just composes the email for you.
          </p>
        </form>
      </section>

      <!-- ========================================================== cta -->
      <!-- The one full-bleed ink band on the page: the last word, set the way a
           colophon is, on the darkest stock available. -->
      <section class="cta">
        <div class="cta-inner">
          <span class="cta-eyebrow">Ready when you are</span>
          <h2>Ready to write the good version?</h2>
          <p>Create an account, pick a design, and have a PDF before your coffee goes cold.</p>
          <div class="cta-buttons">
            @if (signedIn()) {
              <a class="vn-btn vn-btn--lg cta-primary" routerLink="/dashboard">Open dashboard</a>
            } @else {
              <a class="vn-btn vn-btn--lg cta-primary" routerLink="/register">Register</a>
              <a class="vn-btn vn-btn--lg cta-secondary" routerLink="/login">Log in</a>
            }
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-brand">
        <vn-logo [size]="22" />
        <span>Vita<strong>Nova</strong></span>
      </div>
      <p class="footer-note">Angular · FastAPI · WeasyPrint. Built by hand.</p>
      <nav class="footer-links" aria-label="Footer">
        <a href="#how">How it works</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
        <a routerLink="/login">Log in</a>
        <a routerLink="/register">Register</a>
      </nav>
    </footer>
  `,
})
export class LandingPage {
  private readonly templateApi = inject(TemplateApi);
  private readonly auth = inject(AuthService);

  protected readonly contact = CONTACT;
  protected readonly features = FEATURES;
  protected readonly steps = STEPS;
  protected readonly stack = ['Angular 20', 'TypeScript', 'FastAPI', 'MongoDB', 'WeasyPrint'];

  protected readonly signedIn = this.auth.isAuthenticated;

  protected readonly heroTemplates = signal<TemplateMeta[]>([]);
  protected readonly galleryTemplates = signal<TemplateMeta[]>([]);
  protected readonly templatesError = signal('');

  protected readonly navOpen = signal(false);
  protected readonly scrolled = signal(false);

  protected name = '';
  protected email = '';
  protected subject = '';
  protected message = '';

  constructor() {
    this.templateApi.list().subscribe({
      next: (metas) => {
        // Two behind one in the hero stack; the first four fill the gallery strip.
        this.heroTemplates.set(metas.slice(0, 3));
        this.galleryTemplates.set(metas.slice(0, 4));
      },
      error: () =>
        this.templatesError.set(
          'The design gallery could not be loaded — the VitaNova API is not responding.',
        ),
    });
  }

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.scrolled.set(window.scrollY > 8);
  }

  @HostListener('document:click')
  protected closeNav(): void {
    if (this.navOpen()) this.navOpen.set(false);
  }

  protected toggleNav(event: MouseEvent): void {
    event.stopPropagation();
    this.navOpen.update((open) => !open);
  }

  /**
   * Hands the message to the visitor's own mail client rather than posting it.
   * There is no contact endpoint on the API, and a form that showed "sent!"
   * while dropping the message on the floor would be worse than no form.
   */
  protected sendMessage(): void {
    const subject = this.subject.trim() || `VitaNova — a note from ${this.name.trim() || 'a visitor'}`;
    const body = [
      this.message.trim(),
      '',
      '—',
      this.name.trim(),
      this.email.trim(),
    ].join('\n');

    window.location.href =
      `mailto:${CONTACT.email}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
  }
}
