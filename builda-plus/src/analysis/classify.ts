import { z } from 'zod';
import { CLASSIFICATIONS, ROLE_LABELS, STAGES, type Classification } from '../domain/journey';
import type { LLMProvider } from '../llm/provider';
import type { PlaybookCard } from '../knowledge/playbook';
import { quoteAppearsIn } from '../interview/orchestrator';
import type { ConsolidatedPainPoint, KeyMerge } from './consolidate';

export const ClassificationProposalSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  rationale: z.string().min(10).max(1200),
  supportingQuotes: z.array(z.string()).min(1),
  humanElements: z.array(z.string()),
});

export interface ClassificationResult {
  classification: Classification | null;
  source: 'ai_proposed' | 'playbook' | null;
  rationale: string;
  requiresComplianceReview: boolean;
}

const SYSTEM = `You classify one operational pain point from a UK mortgage firm discovery. Choose exactly one:
- overhaul: the underlying process is badly designed and should be redesigned
- fix: a simple process or operational change solves it without automation
- automate: repetitive, structured work suitable for automation with human approval of communications and record changes
- keep_human: needs professional judgement, accountability, relationship management or a human decision
Regulated mortgage advice, suitability and protection decisions are never automated; automation may only prepare information for the adviser.
Prefer fixing the work before automating it. supportingQuotes must be copied exactly from the quotes provided.`;

export async function classifyPainPoint(llm: LLMProvider, pp: ConsolidatedPainPoint, card: PlaybookCard | null): Promise<ClassificationResult> {
  const stage = STAGES[pp.stageId];
  const requiresComplianceReview = stage.regulatedJudgement;
  const fallback = (why: string): ClassificationResult => card
    ? { classification: card.likelyClassification, source: 'playbook', rationale: `Suggested by the mortgage playbook — ${why}, so please check it.`, requiresComplianceReview }
    : { classification: null, source: null, rationale: `Needs your classification — ${why}.`, requiresComplianceReview };

  if (pp.confidence.level === 'insufficient') return fallback('there isn’t enough evidence yet');

  const facts = [
    `Pain point: ${pp.title}`,
    `Stage: ${stage.name}${stage.regulatedJudgement ? ' (involves regulated judgement)' : ''}`,
    `Roles reporting: ${pp.roles.map((r) => ROLE_LABELS[r]).join(', ')}`,
    pp.causes.length ? `Reported causes: ${pp.causes.join('; ')}` : '',
    pp.improvements.length ? `Suggested improvements: ${pp.improvements.join('; ')}` : '',
    pp.systems.length ? `Systems: ${pp.systems.join(', ')}` : '',
    card ? `Playbook suggests: ${card.likelyClassification}. Human approval: ${card.humanApproval.join('; ') || 'n/a'}. Limits: ${card.regulatoryLimits.join('; ') || 'n/a'}` : '',
    'Quotes:',
    ...pp.quotesByRole.map((q) => `- (${ROLE_LABELS[q.role]}) "${q.quote}"`),
  ].filter(Boolean).join('\n');

  try {
    const { data } = await llm.generateStructured({
      task: 'analysis.classify', schemaName: 'classification', schema: ClassificationProposalSchema,
      system: SYSTEM, messages: [{ role: 'user', content: facts }], maxOutputTokens: 1500,
    });
    const quotes = pp.quotesByRole.map((q) => q.quote);
    const verified = data.supportingQuotes.every((sq) => quotes.some((q) => quoteAppearsIn(sq, q) || quoteAppearsIn(q, sq)));
    if (!verified) return fallback('the AI’s proposal couldn’t be matched to what people said');
    return { classification: data.classification, source: 'ai_proposed', rationale: data.rationale, requiresComplianceReview: requiresComplianceReview && data.classification !== 'keep_human' };
  } catch {
    return fallback('the AI couldn’t produce a classification');
  }
}

export const KeyMergeProposalSchema = z.object({
  merges: z.array(z.object({ canonicalKey: z.string(), mergedKeys: z.array(z.string()).min(1), reason: z.string() })),
  notProblems: z.array(z.string()).default([]),
});

export interface KeyReview { merges: KeyMerge[]; notProblems: string[] }

const MERGE_SYSTEM = (playbookKeys: string[]) => `Interview participants in different roles describe the work of one mortgage firm. Each line is a key, the stage, the role(s) and what they said.

1. merges: group keys that are the SAME piece of work, even when:
   - it is described from different sides: an adviser handing a case over and a case manager receiving it is one handover; chasing documents and documents arriving late is one problem;
   - it is worded differently, or one person names the cause and another the effect.
   Do not group different tasks that merely happen at the same stage. Prefer these canonical keys when one fits: ${playbookKeys.join(', ') || 'none'}.
2. notProblems: keys where nobody describes a problem: no time lost, delay, waiting, rework, errors, workaround, frustration or wish for improvement. Only a description of a task, who does it, or that it works fine. When in doubt, leave the key out of notProblems.

Return merges: [] and notProblems: [] if none apply.`;

export async function proposeKeyMerges(llm: LLMProvider, items: { key: string; stage: string; roles: string[]; descriptions: string[]; causes: string[] }[], playbookKeys: string[]): Promise<KeyReview> {
  if (items.length < 2 || items.every((i) => playbookKeys.includes(i.key))) return { merges: [], notProblems: [] };
  const line = (i: (typeof items)[number]) => `${i.key} [${i.stage}; ${i.roles.join(', ')}]: ${i.descriptions.slice(0, 3).join(' | ')}${i.causes.length ? ` | cause: ${i.causes.slice(0, 2).join('; ')}` : ''}`;
  const { data } = await llm.generateStructured({
    task: 'analysis.merge_keys', schemaName: 'key_merges', schema: KeyMergeProposalSchema,
    system: MERGE_SYSTEM(playbookKeys),
    messages: [{ role: 'user', content: items.map(line).join('\n') }],
    maxOutputTokens: 2000,
  });
  return { merges: data.merges, notProblems: data.notProblems ?? [] };
}
