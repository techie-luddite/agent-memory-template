export type MemoryState = "active" | "durable" | "suppressed";

export type MemoryTruthClass =
  | "preference"
  | "environment"
  | "project"
  | "operational"
  | "relationship"
  | "policy"
  | "decision";

export type MemoryStatus = "candidate" | "confirmed" | "superseded" | "invalid" | "inactive";

export interface MemorySource {
  type: string;
  session: string | null;
  evidence: string[];
  [key: string]: unknown;
}

export interface MemoryItem {
  id: string;
  state: MemoryState;
  truth_class: MemoryTruthClass;
  scope: string[];
  subject?: string | null;
  summary: string;
  assertion: string;
  confidence: number;
  importance: number;
  retrieval_weight: number;
  status: MemoryStatus;
  source: MemorySource;
  created_at: string;
  updated_at: string;
  last_reinforced_at?: string | null;
  last_reinforced_in_session?: string | null;
  reinforcement_count?: number;
  review_after_sessions?: number | null;
  review_after_interactions?: number | null;
  activity_state?: "open" | "resolved" | "dormant" | null;
  supersedes?: string[];
  superseded_by?: string | null;
  tags: string[];
}

export interface LoadedMemoryRecord {
  item: MemoryItem;
  filePath: string;
  stateDir: string;
  truthClassDir: string;
}

export interface LoadMemoryRecordsResult {
  records: LoadedMemoryRecord[];
  errors: string[];
}
