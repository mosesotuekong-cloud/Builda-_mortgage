import { z } from 'zod';
import { EXTRACTABLE, IMPACT_CATEGORIES, NODE_KINDS } from './core';

// What the interpreter returns for one answer: the things mentioned, and claims about them, each tied to
// an exact quote. It SUGGESTS which existing node a mention matches; code decides (ingest.ts).
// Stages, roles, parties and types are free strings here and validated against the domain pack in code,
// so the schema is the same for every industry.
export const MentionSchema = z.object({
  ref: z.string().describe('Short local id, e.g. m1'),
  kind: z.enum(NODE_KINDS),
  label: z.string().min(2).max(120).describe('A short neutral name for it, e.g. "Enter fact-find data into the CRM"'),
  words: z.string().describe('The words the participant used for it'),
  match: z.string().nullable().describe('Id of an existing node from the list that is the SAME thing, else null'),
  typeRef: z.string().nullable().describe('Id of the closest type from the domain lists, else null'),
  stage: z.string().nullable().describe('Stage id where it happens, if clear'),
});

export const ClaimDraftSchema = z.object({
  subject: z.string().describe('ref of the mention the claim is about'),
  predicate: z.enum(EXTRACTABLE as [string, ...string[]]),
  objectMention: z.string().nullable().describe('ref of another mention, for relationships'),
  objectRef: z.string().nullable().describe('A role id or party id, when the object is one'),
  value: z.object({
    number: z.number().nullable(),
    unit: z.enum(['minutes', 'hours', 'days', 'weeks']).nullable(),
    per: z.enum(['day', 'week', 'month', 'year']).nullable(),
    raw: z.string(),
  }).nullable().describe('For frequency, duration, delay: the figure exactly as stated'),
  impactCategory: z.enum(IMPACT_CATEGORIES).nullable(),
  text: z.string().nullable(),
  scope: z.string().nullable().describe('Only if the participant limits it: "for buy-to-let", "some advisers", "self-employed clients"'),
  negated: z.boolean(),
  quote: z.string().describe('Copied word-for-word from the latest participant message'),
  stated: z.boolean().describe('true if the words say it; false if it is your interpretation'),
  note: z.string().nullable().describe('When stated is false: why you read it that way'),
});

export const KnowledgeTurnSchema = z.object({
  mentions: z.array(MentionSchema),
  claims: z.array(ClaimDraftSchema),
  stagesConfirmedNotInvolved: z.array(z.string()),
  flags: z.object({
    clientInformation: z.boolean(),
    complaintOrCompliance: z.boolean(),
    employmentIssue: z.boolean(),
    adviceRequest: z.boolean(),
    outOfScope: z.boolean(),
  }),
  wantsToPause: z.boolean(),
  answerWasVague: z.boolean(),
  participantUnsure: z.boolean(),
});
export type KnowledgeTurn = z.infer<typeof KnowledgeTurnSchema>;
export type MentionDraft = z.infer<typeof MentionSchema>;
export type ClaimDraft = z.infer<typeof ClaimDraftSchema>;

// ---------- What the interpreter actually returns: a compact form of the above (design: speed).
// Output tokens are most of a turn's wait, so field names are short and empty fields are left out instead
// of written as null. expandTurn() turns it back into KnowledgeTurn, so everything downstream is unchanged.
export const CompactTurnSchema = z.object({
  m: z.array(z.object({
    r: z.string(), k: z.enum(NODE_KINDS), l: z.string().min(2).max(120),
    w: z.string().optional(), id: z.string().optional(), t: z.string().optional(), s: z.string().optional(),
  })),
  c: z.array(z.object({
    s: z.string(), p: z.enum(EXTRACTABLE as [string, ...string[]]), q: z.string(),
    o: z.string().optional(), n: z.number().optional(), u: z.enum(['minutes', 'hours', 'days', 'weeks']).optional(),
    per: z.enum(['day', 'week', 'month', 'year']).optional(), raw: z.string().optional(), ic: z.enum(IMPACT_CATEGORIES).optional(),
    x: z.string().optional(), sc: z.string().optional(), neg: z.boolean().optional(), inf: z.string().optional(),
  })),
  ni: z.array(z.string()).optional(),
  flags: z.object({ clientInformation: z.boolean(), complaintOrCompliance: z.boolean(), employmentIssue: z.boolean(), adviceRequest: z.boolean(), outOfScope: z.boolean() }),
  pause: z.boolean().optional(), vague: z.boolean().optional(), unsure: z.boolean().optional(),
});
export type CompactTurn = z.infer<typeof CompactTurnSchema>;

// `o` is a mention ref for relationships, or a role/party id; ingest decides which by the predicate.
export function expandTurn(c: CompactTurn): KnowledgeTurn {
  const refs = new Set(c.m.map((x) => x.r));
  return {
    mentions: c.m.map((x) => ({ ref: x.r, kind: x.k, label: x.l, words: x.w ?? x.l, match: x.id ?? null, typeRef: x.t ?? null, stage: x.s ?? null })),
    claims: c.c.map((x) => ({
      subject: x.s, predicate: x.p,
      objectMention: x.o && refs.has(x.o) ? x.o : null, objectRef: x.o && !refs.has(x.o) ? x.o : null,
      value: x.n !== undefined || x.raw !== undefined ? { number: x.n ?? null, unit: x.u ?? null, per: x.per ?? null, raw: x.raw ?? String(x.n ?? '') } : null,
      impactCategory: x.ic ?? null, text: x.x ?? null, scope: x.sc ?? null, negated: !!x.neg, quote: x.q,
      stated: !x.inf, note: x.inf ?? null,
    })),
    stagesConfirmedNotInvolved: c.ni ?? [], flags: c.flags,
    wantsToPause: !!c.pause, answerWasVague: !!c.vague, participantUnsure: !!c.unsure,
  };
}
