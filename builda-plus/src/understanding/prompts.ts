import { EXTRACTABLE, IMPACT_CATEGORIES, PREDICATES } from './core';
import type { DomainPack } from './pack';
import type { Move } from './planner';
import { QUESTION_STYLE, firmContextBlock } from '../interview/prompts';

export const PROMPT_VERSION = 'kn-2026-11-1';

// Domain-agnostic wording; the pack supplies the industry and its advice boundary.
const shared = (pack: DomainPack) => `You are part of BuildA+, a structured discovery of how an organisation in ${pack.name} operates.
The purpose is improving business processes. It is never an assessment of the participant or of any colleague.
${pack.adviceBoundary}`;

export function knowledgeInterpretPrompt(pack: DomainPack, ctx: { roleLabel: string; pseudonym: string; topic: string; candidates: string[]; stagesInScope?: string[] }): string {
  // Only the types for this person's stages (plus untyped ones): a shorter prompt, faster replies.
  const inScope = (stage?: string) => !ctx.stagesInScope?.length || !stage || ctx.stagesInScope.includes(stage);
  const predicates = EXTRACTABLE.map((p) => {
    const d = PREDICATES[p];
    const obj = d.object === 'node' ? ('objectKinds' in d ? `o = a ${(d.objectKinds as readonly string[]).join('/')} mention ref` : 'o = a mention ref') : d.object === 'role' ? 'o = a role id'
      : d.object === 'party' ? 'o = a party id' : d.object === 'value' ? 'n + u or per, raw' : d.object === 'impact' ? 'ic (+ x)' : 'x';
    return `- ${p}: ${d.subject.join('/')} -> ${obj} (${d.label})`;
  }).join('\n');
  return `${shared(pack)}

TASK: Read the participant's LATEST message and record what it says about how the organisation works.
Participant: ${ctx.pseudonym}, role: ${ctx.roleLabel}. Current topic: ${ctx.topic}.
Output is compact: use the short keys below and LEAVE OUT any key that would be empty, null or false.

m = mentions: every activity, role, system, information/document, decision, control (a check or rule) or problem the message talks about.
  r: local ref (m1, m2…) · k: kind · l: a short neutral name ("Enter fact-find data into the CRM")
  w: their own words for it, only if different from l · id: an EXISTING node id below, only if clearly the same thing (same name but different people doing it = not the same)
  t: the closest type id from the lists below · s: a stage id, if clear
c = claims about those mentions, using ONLY these predicates:
${predicates}
  s: subject ref · p: predicate · q: quote copied word-for-word from the latest message (a claim without a real quote is discarded)
  n: a number they actually said, u: its unit (minutes/hours/days/weeks) or per: day/week/month/year, raw: their words for the figure
  ("Sometimes" = raw only). Never calculate, estimate or convert.
  ic: impact category · x: text · sc: scope, only when they limit it ("for buy-to-let", "some advisers") · neg: true for "we don't…"
  inf: ONLY when the claim is your reading rather than their words, saying why. A cause is their words only if they say "because", "so", "means".
  A problem = time lost, delay, waiting, rework, errors, workarounds, frustration. "It works fine" = works_well. Never judge an individual's performance.
ni: stage ids they say they don't work on, or outside the range their part covers.
flags (always all five): clientInformation (the message IDENTIFIES a real client: a name, address or postcode, phone, email, date of birth, account, policy or case reference, or an exact loan amount or property tied to someone; an anonymous example such as "last week a case waited three days for payslips" is NOT client information), complaintOrCompliance (a complaint or misconduct concern), employmentIssue (a personal grievance), adviceRequest (they ask for advice), outOfScope.
pause: they want to stop · vague: no usable detail · unsure: they don't know or can't estimate what was asked.

Roles: ${pack.roles.map((r) => `${r.id} (${r.label})`).join(', ')}
Parties: ${pack.parties.map((r) => `${r.id} (${r.label})`).join(', ')}
Stages: ${pack.stages.map((st) => `${st.id} (${st.name})`).join(', ')}
Impact categories: ${IMPACT_CATEGORIES.join(', ')}
Activity types: ${pack.activityTypes.filter((t) => inScope(t.stage)).map((t) => `${t.id} (${t.label})`).join('; ')}
Information types: ${pack.informationTypes.map((t) => `${t.id} (${t.label})`).join('; ')}
Problem patterns: ${pack.problemPatterns.filter((cd) => inScope(cd.stageId)).map((cd) => `${cd.id} (${cd.title})`).join('; ')}

Existing nodes (id | kind | label | stage):
${ctx.candidates.join('\n') || '(none yet)'}

At most 12 claims, the most informative first. Empty arrays when the message says nothing usable.`;
}

export function knowledgeQuestionPrompt(pack: DomainPack, ctx: {
  roleLabel: string; move: Move; nodeLabel: string | null; ownFacts: string[]; ideas: string[]; firmContext?: string | null; lastAnswerUnsure: boolean;
  recentOpenings?: string[];
}): string {
  const how: Record<Move['type'], string> = {
    probe_variation: 'People describe this differently. Ask, neutrally, whether it differs from case to case or between people. Never say that anyone else described it differently.',
    clarify_conflict: 'Check, neutrally and briefly, that we have this right ("Just so I\'ve got it right…"). Never mention anyone else\'s account.',
    example_request: 'Their last answer was too general to use. Ask for a concrete example: the last time it happened, what happened.',
    investigate_problem: 'Stay with the problem they raised. Do not assume a cause; let them describe it.',
    explore_handoff: 'Ask about the handover between people: what they receive or pass on, and what happens when something is missing.',
    explore_activity: 'Ask an open question about how this part of their work goes, and what, if anything, gets in the way.',
    fill_gap: 'Ask about their own work.',
    confirm_inference: 'Check gently whether our understanding is right, in one short question.',
    open_area: 'Change topic naturally, linking from what they said if you can. Never announce it like "Let\'s move on to X".',
  };
  return `${shared(pack)}

TASK: Write the interviewer's next message to a ${ctx.roleLabel}.
Find out: ${ctx.move.ask}.
${how[ctx.move.type]}${ctx.lastAnswerUnsure ? '\nThey just said they don\'t know or aren\'t sure. Don\'t press: go straight to the new question (a brief, varied acknowledgement at most) and do NOT ask for the same thing again, not even reworded.' : ''}
${ctx.recentOpenings?.length ? `Your last messages began: ${ctx.recentOpenings.map((o) => `"${o}"`).join(', ')}. Begin differently, and don't say "That's fine" if you have already said it.` : ''}
${ctx.ownFacts.length ? `What they have told us so far about ${ctx.nodeLabel ?? 'this'} (don't ask for any of it again):\n${ctx.ownFacts.join('\n')}` : ''}
${ctx.ideas.length ? `Question ideas from the domain playbook (adapt them; don't read them out word for word):\n${ctx.ideas.map((q) => `- ${q}`).join('\n')}` : ''}
${firmContextBlock(ctx.firmContext)}
${QUESTION_STYLE}`;
}
