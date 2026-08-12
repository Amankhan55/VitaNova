/**
 * Mirrors `backend/app/schemas/ai.py`.
 *
 * Same convention as `resume.model.ts`: snake_case, because that is what the
 * API speaks. Keeping the two files in the same dialect means a payload can be
 * moved between them without a translation layer that would only ever be one
 * rename behind.
 */

export type RewriteStyle =
  | 'improve'
  | 'concise'
  | 'professional'
  | 'impactful'
  | 'technical'
  | 'ats';

export type ContentKind =
  | 'summary'
  | 'experience'
  | 'project'
  | 'achievement'
  | 'skills'
  | 'objective';

/** Label and blurb for each rewrite style, as offered in the UI. */
export const REWRITE_STYLES: { id: RewriteStyle; label: string; hint: string }[] = [
  { id: 'improve', label: 'Improve', hint: 'Clearer, same meaning' },
  { id: 'concise', label: 'Make concise', hint: 'Shorter and denser' },
  { id: 'professional', label: 'More professional', hint: 'Formal resume voice' },
  { id: 'impactful', label: 'More impactful', hint: 'Lead with the outcome' },
  { id: 'technical', label: 'Technical', hint: 'Specific about the engineering' },
  { id: 'ats', label: 'ATS-friendly', hint: 'Plain, parser-safe wording' },
];

// --- 1. Resume writer ------------------------------------------------------ //

export interface GenerateRequest {
  kind: ContentKind;
  current?: string;
  role?: string;
  organization?: string;
  tech?: string[];
  context?: string;
}

export interface GeneratedVariant {
  text: string;
  style: string;
}

export interface GenerateResponse {
  kind: ContentKind;
  variants: GeneratedVariant[];
  bullets: string[];
  notes: string[];
}

// --- 2. Bullet rewriter ---------------------------------------------------- //

export interface RewriteRequest {
  bullet: string;
  styles?: RewriteStyle[];
  role?: string;
  organization?: string;
  tech?: string[];
}

export interface RewriteSuggestion {
  text: string;
  style: string;
}

export interface RewriteResponse {
  original: string;
  suggestions: RewriteSuggestion[];
  notes: string[];
}

// --- 3. ATS readiness ------------------------------------------------------ //

export interface AtsCategories {
  keyword_match: number;
  experience: number;
  skills: number;
  formatting: number;
  content_quality: number;
}

export interface AtsRecommendation {
  title: string;
  detail: string;
  /** Which tool can act on this. null means advice only, with no "Fix with AI". */
  action: 'summary' | 'bullet' | 'skills' | null;
  target: string;
}

export interface AtsResponse {
  overall_score: number;
  categories: AtsCategories;
  strengths: string[];
  weaknesses: string[];
  recommendations: AtsRecommendation[];
}

/** Display order and labels for the category bars. */
export const ATS_CATEGORIES: { key: keyof AtsCategories; label: string }[] = [
  { key: 'keyword_match', label: 'Keyword match' },
  { key: 'experience', label: 'Experience' },
  { key: 'skills', label: 'Skills' },
  { key: 'formatting', label: 'Formatting' },
  { key: 'content_quality', label: 'Content quality' },
];

// --- 4. Job description matcher -------------------------------------------- //

export interface MatchedSkill {
  skill: string;
  strength: 'strong' | 'moderate';
  evidence: string;
}

export interface PartialSkill {
  skill: string;
  reason: string;
}

export interface MissingSkill {
  skill: string;
  importance: 'high' | 'medium' | 'low';
}

export interface ExperienceAlignment {
  score: number;
  summary: string;
}

export interface JobMatchResponse {
  match_score: number;
  matched_skills: MatchedSkill[];
  partial_skills: PartialSkill[];
  missing_skills: MissingSkill[];
  matching_keywords: string[];
  missing_keywords: string[];
  experience_alignment: ExperienceAlignment;
  recommendations: string[];
}

// --- Shared display helpers ------------------------------------------------ //

export type ScoreBand = 'strong' | 'fair' | 'weak';

/**
 * Which of three bands a 0–100 score falls in.
 *
 * One function rather than a colour decided at each call site, so the ATS ring,
 * the category bars and the job-match score cannot disagree about what 70 means.
 */
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'fair';
  return 'weak';
}

/**
 * The user-facing message for a failed AI call.
 *
 * Written here rather than at each call site so every surface says the same
 * thing, and so the server's own wording is preferred when it sent some — the
 * backend distinguishes "busy" from "quota reached", and that distinction is
 * the difference between "try again" and "come back later".
 */
export function aiErrorMessage(status: number, detail?: unknown): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (status === 429) return 'AI usage limit reached. Please try again later.';
  if (status === 0) return 'No connection. Check your network and try again.';
  return 'AI is temporarily unavailable. Please try again.';
}
