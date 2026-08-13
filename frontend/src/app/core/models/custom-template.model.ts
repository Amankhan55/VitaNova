/**
 * Mirrors `backend/app/models/custom_template.py`.
 *
 * A custom template is a *spec*, not markup: a fixed set of design decisions,
 * every one of them a union of literals or a number the server clamps. The
 * editor is therefore a panel of controls rather than a code box, and the union
 * types below are what keep those controls in step with what the API accepts —
 * a value TypeScript rejects here is one the server would reject with a 422.
 */

import type { SectionType, Theme } from './resume.model';
import type { TemplateMeta } from './auth.model';

export type CustomLayout = 'single' | 'sidebar-left' | 'sidebar-right';
export type CustomHeaderStyle = 'left' | 'centered' | 'split' | 'banner';
export type CustomHeadingStyle = 'plain' | 'underline' | 'rule' | 'band' | 'bar' | 'boxed';
export type CustomFont = 'sans' | 'grotesk' | 'serif' | 'book' | 'mono';
export type CustomCase = 'normal' | 'upper';
export type CustomAlignment = 'left' | 'center';
export type CustomBulletStyle = 'disc' | 'square' | 'dash' | 'none';
export type CustomTagStyle = 'inline' | 'pill' | 'bracket';
export type CustomDivider = 'none' | 'hairline' | 'dotted';
export type CustomSidebarTone = 'fill' | 'accent' | 'plain';

export interface CustomTemplateSpec {
  layout: CustomLayout;
  sidebar_width: number;
  sidebar_tone: CustomSidebarTone;
  sidebar_sections: SectionType[];
  contacts_in_sidebar: boolean;

  header_style: CustomHeaderStyle;
  name_case: CustomCase;
  show_monogram: boolean;
  show_headline: boolean;
  header_rule: boolean;

  heading_style: CustomHeadingStyle;
  heading_case: CustomCase;
  heading_align: CustomAlignment;
  heading_accent: boolean;

  body_font: CustomFont;
  heading_font: CustomFont;
  name_size_pt: number;
  heading_size_pt: number;
  body_size_pt: number;
  line_height: number;
  heading_tracking: number;

  bullet_style: CustomBulletStyle;
  tag_style: CustomTagStyle;
  entry_divider: CustomDivider;
  rule_weight_pt: number;

  page_margin_mm: number;
  section_gap_px: number;
  entry_gap_px: number;

  ink: string;
  body_colour: string;
  muted_colour: string;
  paper: string;
  sidebar_bg: string;
  sidebar_text: string;
}

export interface CustomTemplate {
  id: string;
  /** The qualified `custom:<id>` form — what a resume stores in `template_id`. */
  template_id: string;
  name: string;
  description: string;
  tags: string[];
  accent: string;
  spec: CustomTemplateSpec;
  theme: Theme;
  ats_safe: boolean;
  created_at: string;
  updated_at: string;
}

/** Both shapes the frontend needs: full documents for the editor, and the
 *  TemplateMeta view the gallery and design panel already render. */
export interface CustomTemplateList {
  templates: CustomTemplate[];
  metas: TemplateMeta[];
}

export interface CustomTemplateCreate {
  name?: string;
  description?: string;
  tags?: string[];
  accent?: string;
  spec?: CustomTemplateSpec;
  theme?: Theme;
  /** Seeds the design from a built-in one. Ignored when `spec` is supplied. */
  based_on?: string;
}

export type CustomTemplatePatch = Partial<
  Pick<CustomTemplate, 'name' | 'description' | 'tags' | 'accent' | 'spec' | 'theme'>
>;

/** True for the qualified ids the server hands out for user designs. */
export function isCustomTemplateId(templateId: string | undefined | null): boolean {
  return !!templateId && templateId.startsWith('custom:');
}

/**
 * The server's own defaults, restated.
 *
 * The editor needs a complete spec before its first save — every control is
 * bound to a field, and `undefined` in a range input is an empty slider. Keeping
 * this in step with `CustomTemplateSpec`'s field defaults in Python is the price
 * of that; `CustomTemplateSpec` in TypeScript has no optional members, so
 * omitting a field here is a compile error rather than a blank control.
 */
export const DEFAULT_SPEC: CustomTemplateSpec = {
  layout: 'single',
  sidebar_width: 32,
  sidebar_tone: 'fill',
  sidebar_sections: ['skills', 'languages', 'certifications'],
  contacts_in_sidebar: true,

  header_style: 'left',
  name_case: 'normal',
  show_monogram: false,
  show_headline: true,
  header_rule: true,

  heading_style: 'underline',
  heading_case: 'upper',
  heading_align: 'left',
  heading_accent: true,

  body_font: 'sans',
  heading_font: 'sans',
  name_size_pt: 24,
  heading_size_pt: 11,
  body_size_pt: 10.2,
  line_height: 1.42,
  heading_tracking: 0.09,

  bullet_style: 'disc',
  tag_style: 'inline',
  entry_divider: 'none',
  rule_weight_pt: 0.8,

  page_margin_mm: 14,
  section_gap_px: 11,
  entry_gap_px: 8,

  ink: '#16202E',
  body_colour: '#33404F',
  muted_colour: '#6B7787',
  paper: '#FFFFFF',
  sidebar_bg: '#F1F5F9',
  sidebar_text: '#33404F',
};

/** Ready-made palettes, so recolouring a design is one click rather than six. */
export const SPEC_PALETTES: { name: string; colours: Partial<CustomTemplateSpec> }[] = [
  {
    name: 'Slate',
    colours: {
      ink: '#16202E', body_colour: '#33404F', muted_colour: '#6B7787',
      paper: '#FFFFFF', sidebar_bg: '#F1F5F9', sidebar_text: '#33404F',
    },
  },
  {
    name: 'Midnight',
    colours: {
      ink: '#0F1D33', body_colour: '#334155', muted_colour: '#64748B',
      paper: '#FFFFFF', sidebar_bg: '#0F1D33', sidebar_text: '#C6D2E2',
    },
  },
  {
    name: 'Warm',
    colours: {
      ink: '#2B2418', body_colour: '#3D372C', muted_colour: '#7A6F5C',
      paper: '#FDFBF5', sidebar_bg: '#F0EAD9', sidebar_text: '#3D372C',
    },
  },
  {
    name: 'Mono',
    colours: {
      ink: '#111111', body_colour: '#1F1F1F', muted_colour: '#6B6B6B',
      paper: '#FFFFFF', sidebar_bg: '#EFEFEF', sidebar_text: '#1F1F1F',
    },
  },
];
