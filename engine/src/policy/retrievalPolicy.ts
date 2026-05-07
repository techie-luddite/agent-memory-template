export interface RetrievalPolicy {
  exactSubjectQueryScore: number;
  summaryQueryScore: number;
  assertionQueryScore: number;
  tagQueryScore: number;
  partialQueryScore: number;
}

const RETRIEVAL_POLICY: RetrievalPolicy = {
  exactSubjectQueryScore: 4,
  summaryQueryScore: 3,
  assertionQueryScore: 2,
  tagQueryScore: 1.5,
  partialQueryScore: 1
};

export function getRetrievalPolicy(): RetrievalPolicy {
  return RETRIEVAL_POLICY;
}
