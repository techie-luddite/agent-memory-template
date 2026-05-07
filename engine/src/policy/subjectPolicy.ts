export interface SubjectPolicy {
  priority: number;
  exclusiveOperational: boolean;
  significanceBonus: number;
}

const DEFAULT_SUBJECT_POLICY: SubjectPolicy = {
  priority: 0,
  exclusiveOperational: false,
  significanceBonus: 0
};

const SUBJECT_POLICIES: Record<string, SubjectPolicy> = {
  "current-focus": {
    priority: 3,
    exclusiveOperational: true,
    significanceBonus: 0.1
  },
  blocker: {
    priority: 2,
    exclusiveOperational: false,
    significanceBonus: 0.1
  },
  policy: {
    priority: 2,
    exclusiveOperational: false,
    significanceBonus: 0
  },
  "priority-order": {
    priority: 1.5,
    exclusiveOperational: false,
    significanceBonus: 0
  }
};

function normalizeSubject(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function getSubjectPolicy(subject: string | null | undefined): SubjectPolicy {
  return SUBJECT_POLICIES[normalizeSubject(subject)] ?? DEFAULT_SUBJECT_POLICY;
}

export function subjectPriority(subject: string | null | undefined): number {
  return getSubjectPolicy(subject).priority;
}

export function isExclusiveOperationalSubject(subject: string | null | undefined): boolean {
  return getSubjectPolicy(subject).exclusiveOperational;
}

export function subjectSignificanceBonus(subject: string | null | undefined): number {
  return getSubjectPolicy(subject).significanceBonus;
}
