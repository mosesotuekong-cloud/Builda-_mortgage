// The domain-agnostic core of how BuildA+ understands an organisation (design decision D4).
// Nothing here is mortgage-specific: industries plug in through a domain pack (pack.ts).

export const NODE_KINDS = ['activity', 'role', 'system', 'information', 'decision', 'control', 'problem'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

// How many values a fact may hold. 'single' means one value per scope: a second, different value from
// another person is a difference to explain (variation or contradiction), not just another value.
export type Cardinality = 'single' | 'many';
export type ObjectType = 'node' | 'role' | 'party' | 'value' | 'impact' | 'text' | 'type';

export interface PredicateDef {
  subject: NodeKind[];
  object: ObjectType;
  objectKinds?: NodeKind[];     // when object is a node
  cardinality: Cardinality;
  label: string;                // plain words, for prompts and gaps
}

export const PREDICATES = {
  performed_by:     { subject: ['activity'], object: 'role', cardinality: 'single', label: 'who does it' },
  uses:             { subject: ['activity'], object: 'node', objectKinds: ['system'], cardinality: 'many', label: 'which system it uses' },
  needs:            { subject: ['activity'], object: 'node', objectKinds: ['information'], cardinality: 'many', label: 'what information it needs' },
  produces:         { subject: ['activity'], object: 'node', objectKinds: ['information'], cardinality: 'many', label: 'what it produces' },
  followed_by:      { subject: ['activity'], object: 'node', objectKinds: ['activity'], cardinality: 'many', label: 'what happens next' },
  decided_by:       { subject: ['decision'], object: 'role', cardinality: 'single', label: 'who makes the decision' },
  governed_by:      { subject: ['activity', 'decision'], object: 'node', objectKinds: ['control'], cardinality: 'many', label: 'which check or rule applies' },
  waits_on:         { subject: ['activity', 'problem'], object: 'party', cardinality: 'many', label: 'who outside the team it waits on' },
  affects:          { subject: ['problem'], object: 'node', objectKinds: ['activity', 'decision'], cardinality: 'many', label: 'which work it affects' },
  contributes_to:   { subject: ['problem'], object: 'node', objectKinds: ['problem'], cardinality: 'many', label: 'what it leads to' },
  frequency:        { subject: ['activity', 'problem'], object: 'value', cardinality: 'single', label: 'roughly how often it happens' },
  duration:         { subject: ['activity', 'problem'], object: 'value', cardinality: 'single', label: 'roughly how long it takes each time' },
  delay:            { subject: ['activity', 'problem'], object: 'value', cardinality: 'single', label: 'how long things wait' },
  impact:           { subject: ['problem'], object: 'impact', cardinality: 'many', label: 'what it costs the team or the client' },
  improvement_idea: { subject: ['problem'], object: 'text', cardinality: 'many', label: 'what would make it easier' },
  works_well:       { subject: ['activity'], object: 'text', cardinality: 'many', label: 'whether it works well' },
  classified_as:    { subject: ['activity', 'information', 'problem', 'role'], object: 'type', cardinality: 'single', label: 'what kind of thing it is' },
  possibly_same_as: { subject: [...NODE_KINDS], object: 'node', cardinality: 'many', label: 'whether it is the same as another' },
  confirms:         { subject: [...NODE_KINDS], object: 'text', cardinality: 'many', label: 'confirmation' },
} as const satisfies Record<string, PredicateDef>;
export type Predicate = keyof typeof PREDICATES;
export const PREDICATE_IDS = Object.keys(PREDICATES) as Predicate[];
// What the interpreter may assert. Classification, merges and confirmations come from code or people.
export const EXTRACTABLE: Predicate[] = PREDICATE_IDS.filter((p) => !['possibly_same_as', 'confirms', 'classified_as'].includes(p));

// Outcome and impact categories that apply to any organisation.
export const IMPACT_CATEGORIES = ['time', 'delay', 'rework', 'error', 'repeat_contact', 'risk', 'customer_experience', 'cost', 'revenue', 'other'] as const;
export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];

// Fact statuses (design decisions D2 and D3). Computed by code from claims; the AI never sets them.
export type FactStatus = 'unknown' | 'inferred_only' | 'observed' | 'corroborated' | 'confirmed' | 'varies' | 'unexplained_difference' | 'contradicted';

export type Polarity = 'asserted' | 'negated';
export type ClaimStatus = 'active' | 'superseded' | 'rejected';

// Measures, normalised in code (never by the AI): frequency per month, duration in minutes, delay in days.
export interface MeasureValue { raw: string; number: number | null; unit: string | null; normalised: number | null; normalisedUnit: 'per_month' | 'minutes' | 'days' | null; assumption?: string }

export interface KnNode {
  id: string; kind: NodeKind; label: string; aliases: string[]; stageRef: string | null;
  typeRef: string | null; typeVersion: string | null; partOf: string | null; mergedInto: string | null;
}
export interface KnEvidence { id: string; sessionId: string | null; turnIndex: number | null; pseudonym: string | null; roleRef: string | null; source: string; quote: string }
export interface KnClaim {
  id: string; subjectId: string; predicate: Predicate;
  objectNodeId: string | null; objectRef: string | null; objectValue: MeasureValue | { category: string; text: string | null } | { text: string } | null;
  scope: string | null; polarity: Polarity; stated: boolean; inferenceNote: string | null; interpretedBy: string;
  status: ClaimStatus; supersededBy: string | null; evidenceIds: string[];
  // Denormalised from the claim's evidence, for the rules: who said it.
  pseudonym: string | null; roleRef: string | null; createdAt: string;
}
export interface KnGap { subjectId: string; predicate: string; status: 'open' | 'asked' | 'unsure' | 'answered'; timesAsked: number }

export interface KnowledgeSnapshot { nodes: KnNode[]; claims: KnClaim[]; evidence: KnEvidence[] }

// Follow merges to the surviving node.
export function rootOf(nodes: Map<string, KnNode>, id: string): string {
  let cur = id; const seen = new Set<string>();
  while (nodes.get(cur)?.mergedInto && !seen.has(cur)) { seen.add(cur); cur = nodes.get(cur)!.mergedInto!; }
  return cur;
}

export const normLabel = (s: string) => s.toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an|our|my|their|of|to|for|into|in|on)\b/g, ' ').replace(/\s+/g, ' ').trim();
