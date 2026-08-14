/**
 * Field limits, mirroring `backend/app/models/resume.py`.
 *
 * The API enforces these and answers 422 to anything over. That rejection is
 * invisible in the editor -- autosave shows "error" with no explanation, and
 * the live preview simply stops updating -- so the editor's job is to make the
 * limit unreachable rather than to report it after the fact. Every `maxlength`
 * in the panels comes from here.
 *
 * Keep in step with the backend. The values are deliberately far above what any
 * real resume contains; if one ever needs raising, raise it in both places.
 */
export const LIMITS = {
  /** Names, roles, organisations, locations, dates: one line of a form. */
  short: 200,
  /** Headlines, links, notes: a long line. */
  line: 500,
  /** One bullet, or an entry's summary. */
  prose: 2000,
  /** The summary section, the only genuinely long-form field. */
  longProse: 5000,
  /** A single skill keyword or technology tag. */
  keyword: 100,
  /** The monogram shown by the sidebar designs. */
  initials: 8,

  maxSections: 30,
  maxItemsPerSection: 60,
  maxBullets: 40,
  maxKeywords: 60,
  maxLinks: 15,
} as const;
