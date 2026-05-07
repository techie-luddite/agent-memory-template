import type { MemoryItem } from "../types/MemoryItem.js";
import type { RetrievalSet } from "../retrieval/buildRetrievalSet.js";

export interface RetrievalPacketItem {
  id: string;
  summary: string;
  truth_class: MemoryItem["truth_class"];
  subject: string | null;
  scope: string[];
  status: MemoryItem["status"];
}

export interface RetrievalPacket {
  query: string;
  scope: string[];
  active: RetrievalPacketItem[];
  durable: RetrievalPacketItem[];
  policies: RetrievalPacketItem[];
  suppressed_considered?: boolean;
  notes?: string | null;
}

function toPacketItem(record: MemoryItem): RetrievalPacketItem {
  return {
    id: record.id,
    summary: record.summary,
    truth_class: record.truth_class,
    subject: record.subject ?? null,
    scope: record.scope,
    status: record.status
  };
}

export function buildRetrievalPacket(query: string, scope: string[], retrievalSet: RetrievalSet): RetrievalPacket {
  return {
    query,
    scope,
    active: retrievalSet.active.map(toPacketItem),
    durable: retrievalSet.durable.map(toPacketItem),
    policies: retrievalSet.policies.map(toPacketItem),
    suppressed_considered: retrievalSet.suppressedConsidered,
    notes: retrievalSet.notes
  };
}
