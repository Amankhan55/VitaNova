/**
 * Mirrors `backend/app/models/resume.py`. Sections are a discriminated union on
 * `type`, so narrowing a section narrows its item type too.
 */

export type SectionType =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'languages'
  | 'custom';

export type LinkIcon = 'link' | 'github' | 'linkedin' | 'globe' | 'mail' | 'phone' | 'pin';

export interface ResumeLink {
  label: string;
  url: string;
  icon: LinkIcon;
}

export interface Basics {
  full_name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: ResumeLink[];
  initials: string;
}

export interface ExperienceItem {
  id: string;
  role: string;
  organization: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  summary: string;
  bullets: string[];
  tech: string[];
}

export interface EducationItem {
  id: string;
  degree: string;
  institution: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  details: string[];
}

export interface SkillGroupItem {
  id: string;
  label: string;
  keywords: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  link: string;
  period: string;
  tech: string[];
  bullets: string[];
}

export interface CertificationItem {
  id: string;
  name: string;
  issuer: string;
  date: string;
  note: string;
}

export interface LanguageItem {
  id: string;
  name: string;
  level: string;
}

export interface CustomItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  bullets: string[];
}

interface SectionBase {
  id: string;
  title: string;
  visible: boolean;
}

export interface SummarySection extends SectionBase { type: 'summary'; content: string; }
export interface ExperienceSection extends SectionBase { type: 'experience'; items: ExperienceItem[]; }
export interface EducationSection extends SectionBase { type: 'education'; items: EducationItem[]; }
export interface SkillsSection extends SectionBase { type: 'skills'; items: SkillGroupItem[]; }
export interface ProjectsSection extends SectionBase { type: 'projects'; items: ProjectItem[]; }
export interface CertificationsSection extends SectionBase { type: 'certifications'; items: CertificationItem[]; }
export interface LanguagesSection extends SectionBase { type: 'languages'; items: LanguageItem[]; }
export interface CustomSection extends SectionBase { type: 'custom'; items: CustomItem[]; }

export type ResumeSection =
  | SummarySection
  | ExperienceSection
  | EducationSection
  | SkillsSection
  | ProjectsSection
  | CertificationsSection
  | LanguagesSection
  | CustomSection;

/** Any section that holds a list of items — i.e. everything except `summary`. */
export type ItemSection = Exclude<ResumeSection, SummarySection>;
export type ResumeItem = ItemSection['items'][number];

export interface Theme {
  accent: string;
  font_scale: number;
  page_size: 'A4' | 'Letter';
  density: 'compact' | 'normal' | 'relaxed';
}

export interface Resume {
  id: string;
  title: string;
  template_id: string;
  theme: Theme;
  basics: Basics;
  sections: ResumeSection[];
  created_at: string;
  updated_at: string;
}

export interface ResumeSummary {
  id: string;
  title: string;
  template_id: string;
  full_name: string;
  headline: string;
  created_at: string;
  updated_at: string;
}

export interface RenderRequest {
  template_id: string;
  theme: Theme;
  basics: Basics;
  sections: ResumeSection[];
}

export const SECTION_LABELS: Record<SectionType, string> = {
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certifications: 'Certifications',
  languages: 'Languages',
  custom: 'Custom',
};

export const SECTION_ICONS: Record<SectionType, string> = {
  summary: 'file',
  experience: 'briefcase',
  education: 'graduation',
  skills: 'sparkle',
  projects: 'layers',
  certifications: 'award',
  languages: 'languages',
  custom: 'plus',
};
