import type { MemoryTruthClass } from "../types/MemoryItem.js";

export interface TruthClassPolicy {
  duplicateSummaryMatch: boolean;
  duplicateAssertionMatch: boolean;
  supersedeThreshold: number;
  reinforceBySubject: boolean;
  subjectExclusive: boolean;
  allowSupersede: boolean;
  durableByDefault: boolean;
}

const TRUTH_CLASS_POLICIES: Record<MemoryTruthClass, TruthClassPolicy> = {
  preference: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.8,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: false,
    durableByDefault: false
  },
  environment: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.85,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: true,
    durableByDefault: false
  },
  project: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.82,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: true,
    durableByDefault: false
  },
  operational: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.62,
    reinforceBySubject: true,
    subjectExclusive: true,
    allowSupersede: true,
    durableByDefault: false
  },
  relationship: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.78,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: false,
    durableByDefault: false
  },
  policy: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.9,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: false,
    durableByDefault: true
  },
  decision: {
    duplicateSummaryMatch: true,
    duplicateAssertionMatch: true,
    supersedeThreshold: 0.88,
    reinforceBySubject: true,
    subjectExclusive: false,
    allowSupersede: false,
    durableByDefault: true
  }
};

export function getTruthClassPolicy(truthClass: MemoryTruthClass): TruthClassPolicy {
  return TRUTH_CLASS_POLICIES[truthClass];
}

export function prefersDurableByTruthClass(truthClass: MemoryTruthClass): boolean {
  return getTruthClassPolicy(truthClass).durableByDefault;
}
