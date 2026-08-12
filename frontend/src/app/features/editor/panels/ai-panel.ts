import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ATS_CATEGORIES,
  AtsRecommendation,
  MissingSkill,
  scoreBand,
} from '../../../core/models/ai.model';
import { ExperienceSection, SummarySection } from '../../../core/models/resume.model';
import { Icon } from '../../../shared/ui/icon/icon';
import { AiStore } from '../ai-store';
import { ResumeStore } from '../resume-store';

type Tool = 'ats' | 'match';

/** Below this a pasted job description is a job *title*, and the API refuses it. */
const MIN_JD_LENGTH = 40;

/**
 * The two whole-document tools, in the editor's third tab.
 *
 * These earn the room a tab gives them — an ATS report is a page of findings,
 * and a job match is two columns of skills. The per-field tools stay inline
 * where the writing is; only these come here.
 */
@Component({
  selector: 'vn-ai-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  styleUrl: './ai-panel.scss',
  template: `
    <div class="tools" role="tablist" aria-label="AI tools">
      @for (item of tools; track item.id) {
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="tool() === item.id"
          [class.is-active]="tool() === item.id"
          (click)="tool.set(item.id)"
        >
          <vn-icon [name]="item.icon" [size]="14" />
          {{ item.label }}
        </button>
      }
    </div>

    @if (tool() === 'ats') {
      <!-- ------------------------------------------------------ ATS readiness -->
      <section class="tool">
        <p class="lede">
          An estimate of how well your resume aligns with common ATS parsing and
          recruiter expectations. It is not a score from any specific employer's system.
        </p>

        <button
          class="vn-btn vn-btn--primary run"
          type="button"
          [disabled]="store.busy() || !hasResume()"
          (click)="store.runAts()"
        >
          <vn-icon [name]="store.atsState() === 'loading' ? 'refresh' : 'shield'" [size]="15" />
          {{ store.atsState() === 'loading' ? 'Analysing…' : 'Analyse resume' }}
        </button>

        @if (store.atsState() === 'error') {
          <p class="failed" role="alert">
            {{ store.atsError() }}
            <button class="vn-btn vn-btn--sm" type="button" (click)="store.runAts()">Retry</button>
          </p>
        }

        @if (store.ats(); as report) {
          <div class="score-head" [class]="'band--' + band(report.overall_score)">
            <div class="score-ring" [style.--fill]="report.overall_score">
              <span class="score-value">{{ report.overall_score }}</span>
              <span class="score-of">/ 100</span>
            </div>
            <div class="score-copy">
              <span class="vn-eyebrow">ATS readiness score</span>
              <p>{{ verdict(report.overall_score) }}</p>
            </div>
          </div>

          <ul class="bars">
            @for (category of categories; track category.key) {
              <li>
                <span class="bar-label">{{ category.label }}</span>
                <span class="bar-track">
                  <span
                    class="bar-fill"
                    [class]="'band--' + band(report.categories[category.key])"
                    [style.width.%]="report.categories[category.key]"
                  ></span>
                </span>
                <span class="bar-value">{{ report.categories[category.key] }}</span>
              </li>
            }
          </ul>

          @if (report.strengths.length) {
            <h3 class="finding-head finding-head--good">
              <vn-icon name="check" [size]="14" /> Strengths
            </h3>
            <ul class="findings">
              @for (item of report.strengths; track item) { <li>{{ item }}</li> }
            </ul>
          }

          @if (report.weaknesses.length) {
            <h3 class="finding-head finding-head--warn">
              <vn-icon name="zap" [size]="14" /> Areas to improve
            </h3>
            <ul class="findings">
              @for (item of report.weaknesses; track item) { <li>{{ item }}</li> }
            </ul>
          }

          @if (report.recommendations.length) {
            <h3 class="finding-head">
              <vn-icon name="sparkle" [size]="14" /> Recommendations
            </h3>
            <ul class="recommendations">
              @for (item of report.recommendations; track item.title) {
                <li>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                  @if (fixTarget(item); as target) {
                    <button
                      class="vn-btn vn-btn--sm vn-btn--soft"
                      type="button"
                      [disabled]="store.busy()"
                      (click)="fixWithAi(item)"
                    >
                      <vn-icon name="sparkle" [size]="13" />
                      Fix with AI — {{ target }}
                    </button>
                  }
                </li>
              }
            </ul>
          }
        }
      </section>
    } @else {
      <!-- -------------------------------------------------------- job matcher -->
      <section class="tool">
        <label class="vn-field">
          <span class="vn-label">Job description</span>
          <textarea
            class="vn-textarea"
            rows="9"
            [ngModel]="jobDescription()"
            (ngModelChange)="jobDescription.set($event)"
            placeholder="Paste the full job posting here…"
          ></textarea>
          <span class="vn-hint">
            Nothing is stored. It is sent once, compared against your resume, and discarded.
          </span>
        </label>

        <button
          class="vn-btn vn-btn--primary run"
          type="button"
          [disabled]="store.busy() || !canMatch()"
          (click)="store.runJobMatch(jobDescription())"
        >
          <vn-icon [name]="store.matchState() === 'loading' ? 'refresh' : 'search'" [size]="15" />
          {{ store.matchState() === 'loading' ? 'Comparing…' : 'Analyse job match' }}
        </button>

        @if (store.matchState() === 'error') {
          <p class="failed" role="alert">
            {{ store.matchError() }}
            <button
              class="vn-btn vn-btn--sm"
              type="button"
              (click)="store.runJobMatch(jobDescription())"
            >
              Retry
            </button>
          </p>
        }

        @if (store.match(); as report) {
          <div class="score-head" [class]="'band--' + band(report.match_score)">
            <div class="score-ring" [style.--fill]="report.match_score">
              <span class="score-value">{{ report.match_score }}<small>%</small></span>
            </div>
            <div class="score-copy">
              <span class="vn-eyebrow">Match score</span>
              <p>{{ report.experience_alignment.summary }}</p>
            </div>
          </div>

          <h3 class="finding-head"><vn-icon name="layers" [size]="14" /> Skills match</h3>
          <ul class="skills">
            @for (item of report.matched_skills; track item.skill) {
              <li class="skill skill--strong">
                <span class="skill-name">{{ item.skill }}</span>
                <span class="skill-state">
                  <vn-icon name="check" [size]="13" />
                  {{ item.strength === 'strong' ? 'Strong' : 'Present' }}
                </span>
                @if (item.evidence) { <span class="skill-why">{{ item.evidence }}</span> }
              </li>
            }
            @for (item of report.partial_skills; track item.skill) {
              <li class="skill skill--partial">
                <span class="skill-name">{{ item.skill }}</span>
                <span class="skill-state"><vn-icon name="minus" [size]="13" /> Partial</span>
                <span class="skill-why">{{ item.reason }}</span>
              </li>
            }
            @for (item of report.missing_skills; track item.skill) {
              <li class="skill skill--missing">
                <span class="skill-name">{{ item.skill }}</span>
                <span class="skill-state"><vn-icon name="x" [size]="13" /> Missing</span>
                <span class="skill-why">{{ importanceNote(item) }}</span>
              </li>
            }
          </ul>

          @if (report.matching_keywords.length) {
            <h3 class="finding-head finding-head--good">
              <vn-icon name="check" [size]="14" /> Matching keywords
            </h3>
            <div class="keywords">
              @for (word of report.matching_keywords; track word) {
                <span class="vn-chip">{{ word }}</span>
              }
            </div>
          }

          @if (report.missing_keywords.length) {
            <h3 class="finding-head finding-head--warn">
              <vn-icon name="zap" [size]="14" /> Missing keywords
            </h3>
            <div class="keywords">
              @for (word of report.missing_keywords; track word) {
                <span class="vn-chip keyword--missing">{{ word }}</span>
              }
            </div>
            <p class="caveat">
              Only add a keyword if it genuinely describes your experience.
            </p>
          }

          <h3 class="finding-head">
            <vn-icon name="briefcase" [size]="14" /> Experience alignment
            <span class="vn-chip">{{ report.experience_alignment.score }}/100</span>
          </h3>
          <p class="alignment">{{ report.experience_alignment.summary }}</p>

          @if (report.recommendations.length) {
            <h3 class="finding-head"><vn-icon name="sparkle" [size]="14" /> Recommendations</h3>
            <ul class="findings">
              @for (item of report.recommendations; track item) { <li>{{ item }}</li> }
            </ul>
          }
        }
      </section>
    }
  `,
})
export class AiPanel {
  protected readonly store = inject(AiStore);
  private readonly resume = inject(ResumeStore);

  protected readonly tool = signal<Tool>('ats');
  protected readonly jobDescription = signal('');
  protected readonly categories = ATS_CATEGORIES;

  protected readonly tools = [
    { id: 'ats' as const, label: 'ATS score', icon: 'shield' as const },
    { id: 'match' as const, label: 'Job match', icon: 'search' as const },
  ];

  protected readonly hasResume = computed(() => this.resume.resume() !== null);
  protected readonly canMatch = computed(
    () => this.jobDescription().trim().length >= MIN_JD_LENGTH,
  );

  protected band(score: number): string {
    return scoreBand(score);
  }

  protected verdict(score: number): string {
    switch (scoreBand(score)) {
      case 'strong':
        return 'This reads well to both a parser and a person. The notes below are refinements.';
      case 'fair':
        return 'The structure is sound. Tightening the points below would raise it further.';
      default:
        return 'There is real ground to gain here. Start with the recommendations below.';
    }
  }

  protected importanceNote(skill: MissingSkill): string {
    const weight =
      skill.importance === 'high'
        ? 'Emphasised in the posting'
        : skill.importance === 'medium'
          ? 'Mentioned in the posting'
          : 'Nice to have';
    // Never "add this skill". The user may simply not have it, and a resume
    // that claims otherwise fails at the interview instead of the filter.
    return `${weight}. If you have used it, consider adding it to Skills or Experience.`;
  }

  /** The label for a recommendation's Fix button, or null when there is nothing to act on. */
  protected fixTarget(item: AtsRecommendation): string | null {
    if (item.action === 'summary') return this.summarySection() ? 'summary' : null;
    if (item.action === 'bullet') return this.firstExperience() ? 'experience' : null;
    return null;
  }

  /**
   * Hand a recommendation to the writer.
   *
   * The panel opens against the same field the Content tab would open it
   * against, so accepting here and accepting there do exactly the same thing —
   * there is one path that changes a resume, and it goes through `ResumeStore`.
   */
  protected fixWithAi(item: AtsRecommendation): void {
    if (item.action === 'summary') {
      const section = this.summarySection();
      if (!section) return;
      this.store.openWriter({
        key: `summary:${section.id}`,
        title: 'Professional summary',
        request: { kind: 'summary', current: section.content, context: item.detail },
        apply: ([text]) =>
          this.resume.updateSection(section.id, (current) => ({
            ...(current as SummarySection),
            content: text,
          })),
      });
      return;
    }

    if (item.action === 'bullet') {
      const found = this.firstExperience();
      if (!found) return;
      const { section, index } = found;
      const entry = section.items[index];
      this.store.openWriter({
        key: `experience:${entry.id}`,
        title: `${entry.role || 'Experience'} — highlights`,
        request: {
          kind: 'experience',
          current: entry.bullets.join('\n'),
          role: entry.role,
          organization: entry.organization,
          tech: entry.tech,
          context: item.detail,
        },
        apply: (bullets) =>
          this.resume.updateSection(section.id, (current) => {
            const target = current as ExperienceSection;
            return {
              ...target,
              items: target.items.map((candidate) =>
                candidate.id === entry.id ? { ...candidate, bullets } : candidate,
              ),
            };
          }),
      });
    }
  }

  private summarySection(): SummarySection | null {
    const section = this.resume
      .resume()
      ?.sections.find((candidate) => candidate.type === 'summary');
    return (section as SummarySection | undefined) ?? null;
  }

  /** The first experience entry, which is where a bullet recommendation lands. */
  private firstExperience(): { section: ExperienceSection; index: number } | null {
    const section = this.resume
      .resume()
      ?.sections.find(
        (candidate): candidate is ExperienceSection =>
          candidate.type === 'experience' && candidate.items.length > 0,
      );
    return section ? { section, index: 0 } : null;
  }
}
