/**
 * Factories for new sections and items.
 *
 * Ids are generated client-side so a freshly added item is immediately
 * addressable by `@for` tracking and drag-and-drop, without a server round trip.
 */
import {
  CertificationItem,
  CustomItem,
  EducationItem,
  ExperienceItem,
  ItemSection,
  LanguageItem,
  ProjectItem,
  ResumeItem,
  ResumeSection,
  SectionType,
  SkillGroupItem,
} from './resume.model';

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function emptyExperience(): ExperienceItem {
  return {
    id: newId(), role: '', organization: '', location: '',
    start: '', end: '', current: false, summary: '', bullets: [''], tech: [],
  };
}

export function emptyEducation(): EducationItem {
  return {
    id: newId(), degree: '', institution: '', location: '',
    start: '', end: '', current: false, details: [],
  };
}

export function emptySkillGroup(): SkillGroupItem {
  return { id: newId(), label: '', keywords: [] };
}

export function emptyProject(): ProjectItem {
  return { id: newId(), name: '', link: '', period: '', tech: [], bullets: [''] };
}

export function emptyCertification(): CertificationItem {
  return { id: newId(), name: '', issuer: '', date: '', note: '' };
}

export function emptyLanguage(): LanguageItem {
  return { id: newId(), name: '', level: '' };
}

export function emptyCustom(): CustomItem {
  return { id: newId(), title: '', subtitle: '', meta: '', bullets: [''] };
}

/** A blank item of the right shape for the given section. */
export function emptyItemFor(section: ItemSection): ResumeItem {
  switch (section.type) {
    case 'experience': return emptyExperience();
    case 'education': return emptyEducation();
    case 'skills': return emptySkillGroup();
    case 'projects': return emptyProject();
    case 'certifications': return emptyCertification();
    case 'languages': return emptyLanguage();
    case 'custom': return emptyCustom();
  }
}

const DEFAULT_TITLES: Record<SectionType, string> = {
  summary: 'Professional Summary',
  experience: 'Professional Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certifications: 'Certifications',
  languages: 'Languages',
  custom: 'Additional',
};

export function emptySection(type: SectionType, title?: string): ResumeSection {
  const base = { id: newId(), title: title ?? DEFAULT_TITLES[type], visible: true };
  switch (type) {
    case 'summary': return { ...base, type, content: '' };
    case 'experience': return { ...base, type, items: [emptyExperience()] };
    case 'education': return { ...base, type, items: [emptyEducation()] };
    case 'skills': return { ...base, type, items: [emptySkillGroup()] };
    case 'projects': return { ...base, type, items: [emptyProject()] };
    case 'certifications': return { ...base, type, items: [emptyCertification()] };
    case 'languages': return { ...base, type, items: [emptyLanguage()] };
    case 'custom': return { ...base, type, items: [emptyCustom()] };
  }
}

export function isItemSection(section: ResumeSection): section is ItemSection {
  return section.type !== 'summary';
}
