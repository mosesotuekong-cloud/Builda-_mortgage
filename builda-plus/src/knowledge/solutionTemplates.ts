import type { Classification } from '../domain/journey';
import { TEMPLATES } from './templates';

// JADA reference solution templates (Phase 5). Maintained by JADA engineering in this file and changed
// only through code review, so every version is reviewed and traceable in git. A template is a reviewed
// starting point for solution design, never an instruction to build: the engineer still records the design.
//
// Readiness is three separate facts, never merged into one label:
//  - approval.status: has JADA reviewed the design? ('draft' | 'reviewed')
//  - validation:      has it worked in a real implementation? ('untested' | 'tested')
//  - integrationGate: is there an external go/no-go that must pass before live access? (e.g. Outlook spike)
// Only reviewed + tested + gate passed (or no gate) counts as production-ready.

export type SolutionApproach = 'process_redesign' | 'process_or_configuration_fix' | 'conventional_automation' | 'ai_assisted';
export const APPROACH_LABEL: Record<SolutionApproach, string> = {
  process_redesign: 'Process redesign',
  process_or_configuration_fix: 'Process or configuration fix',
  conventional_automation: 'Conventional automation (rules, schedules, templates; no AI)',
  ai_assisted: 'AI-assisted automation (a model with human review)',
};
// Which approaches each classification may use. Keep human has none: it isn't implemented as a change.
export const APPROACHES_FOR: Record<Classification, SolutionApproach[]> = {
  overhaul: ['process_redesign'],
  fix: ['process_or_configuration_fix'],
  automate: ['conventional_automation', 'ai_assisted'],
  keep_human: [],
};

export interface IntegrationGate {
  id: string; description: string; status: 'not_run' | 'passed' | 'failed';
  evidenceRef: string; blocks: string;
}
export interface SolutionTemplate {
  id: string; version: string; name: string;
  problem: string;
  painPointKeys: string[];
  applicableClassifications: Classification[];
  approach: SolutionApproach;
  supportedSystems: string[];
  requiredInputs: string[];
  requiredPermissions: string[];
  architectureOverview: string[];
  humanControls: string[];
  knownLimitations: string[];
  testingRequirements: string[];
  acceptanceCriteria: string[];
  complexity: { estimate: 'low' | 'medium' | 'high'; validated: boolean; basis: string };
  durationEstimate: { text: string; validated: boolean; basis: string } | null;
  approval: { status: 'draft' | 'reviewed'; by: string | null; on: string | null; note: string };
  validation: 'untested' | 'tested';
  integrationGate: IntegrationGate | null;
  specRef: string | null;
}

// The Outlook spike's go/no-go (docs/archive/engineering/outlook-spike-checklist.md). Changed only when the spike
// evidence is signed off; nothing in BuildA+ connects to Microsoft Graph either way.
export const OUTLOOK_SPIKE_GATE: IntegrationGate = {
  id: 'outlook_spike_rev2_1',
  description: 'Microsoft 365 test-tenant spike: critical tests T1–T5, T7, T8, T11, T12, T17, T19, T22, T26–T31, T33 must pass, with evidence signed off.',
  status: 'not_run',
  evidenceRef: 'docs/archive/engineering/outlook-spike-checklist.md',
  blocks: 'Any connection to a firm’s Microsoft 365 tenant: the real Graph transport, onboarding scripts and pilot mailboxes.',
};

const docs = TEMPLATES.find((t) => t.id === 'document_chasing_v1')!;

export const SOLUTION_TEMPLATES: SolutionTemplate[] = [
  {
    id: 'document_chasing_v1', version: '1', name: docs.name,
    problem: 'Staff spend time chasing clients for outstanding documents, case by case.',
    painPointKeys: docs.painPointKeys, applicableClassifications: ['automate'], approach: 'conventional_automation',
    supportedSystems: ['A case system with an API or an agreed export of outstanding documents', 'A firm-approved sending mailbox'],
    requiredInputs: ['Outstanding-documents list per case', 'Firm-approved reminder wording', 'Reminder schedule', 'Named approver at the firm'],
    requiredPermissions: docs.spec.accessRequirements,
    architectureOverview: docs.spec.targetProcess,
    humanControls: docs.spec.humanApprovalPoints,
    knownLimitations: [...docs.spec.standardRisks, ...docs.spec.outOfScope.map((x) => `Out of scope: ${x}`)],
    testingRequirements: docs.spec.testCases.map((c) => `${c.name}: given ${c.given.toLowerCase()}, when ${c.when.toLowerCase()}, then ${c.then.toLowerCase()}`),
    acceptanceCriteria: docs.spec.definitionOfDone,
    complexity: { estimate: docs.typicalComplexity, validated: false, basis: 'Engineering estimate; no implementation completed yet' },
    durationEstimate: null,
    approval: { status: 'draft', by: null, on: null, note: 'Template content exists, but no recorded JADA design review yet.' },
    validation: 'untested', integrationGate: null, specRef: null,
  },
  {
    id: 'outlook_follow_up_drafts_r2_1', version: '2.1', name: 'Outlook follow-up drafts for enrolled conversations',
    problem: 'Case managers chase document requests by email, remembering and writing each follow-up by hand.',
    painPointKeys: ['document_chasing'], applicableClassifications: ['automate'], approach: 'conventional_automation',
    supportedSystems: ['Microsoft 365 / Exchange Online mailboxes of named case managers', 'Outlook (desktop, web or new Outlook) with categories and Quick Steps'],
    requiredInputs: [
      'Named case-manager mailboxes, in a mail-enabled security group used as the management scope',
      'Firm-approved follow-up wording (template text with no client data) and the follow-up schedule',
      'An Exchange administrator for the scoping steps',
      'Shadow-mode baseline period (5–10 business days) before drafts go live',
    ],
    requiredPermissions: [
      'Application Mail.ReadWrite granted only through Exchange Online RBAC for Applications, limited to the management scope',
      'No Microsoft Graph application permissions requested in the app manifest; no unscoped Entra-consented mail permission',
      'No Mail.Send permission: every email is sent by a person in Outlook',
    ],
    architectureOverview: [
      'Explicit enrolment: the case manager applies the “JADA Follow-up” category to a sent request (Quick Step).',
      'Enrolment discovery job: one category-filtered query on Sent Items, metadata only. No continuous mailbox scanning.',
      'Processing job, separate from discovery: per-conversation checks on enrolled conversations only, filtered by stored conversationId.',
      'All Graph calls pass through the JADA gateway: allowlisted request shapes, $select allowlist, ImmutableId on every request, rejection before the network.',
      'When a step is due and nothing has changed, createReply with the approved wording creates a draft; the response is discarded apart from its id.',
      'Controls are Outlook categories (pause, done, cancel); expiry at 30 working days after enrolment or 10 after the final follow-up, whichever is first.',
    ],
    humanControls: [
      'Enrolment is a deliberate action by the case manager on one conversation.',
      'Every follow-up is a draft; a person reviews and sends it in Outlook.',
      'No second draft while one is unsent; a manual follow-up counts as that step.',
      'Client replies stop further drafts.',
    ],
    knownLimitations: [
      'Microsoft can only scope access to whole mailboxes; the conversation-level restriction is enforced by JADA’s application (to be stated in the DPIA).',
      'Mail.ReadWrite technically allows reading every message in a scoped mailbox; JADA’s gateway restricts what is requested.',
      'Microsoft-dependent behaviour (category filter, createReply recipients, draft marking) is unverified until the spike passes.',
    ],
    testingRequirements: [
      'All critical spike tests pass in a test tenant before any firm connection (outlook-spike-checklist.md).',
      'Gateway tests against a fake Graph transport: disallowed request shapes rejected before the network; ImmutableId on every request.',
      'Duplicate prevention, expiry and pause/done/cancel categories behave as specified.',
      'Logs and database contain no email content.',
    ],
    acceptanceCriteria: [
      'Runtime sends = 0 (Microsoft-enforced) throughout the pilot.',
      'Only enrolled conversations are touched over a three-day run (spike T31 evidence).',
      'Shadow-mode baseline recorded for M1 (request to documents received) and M3 (chasing time) before drafts go live.',
      'DPIA and employee briefing state the A2 disclosure before onboarding.',
    ],
    complexity: { estimate: 'medium', validated: false, basis: 'Specification §11 estimate (about 3½–4½ weeks to tested, one engineer); not yet delivered' },
    durationEstimate: { text: 'About 3½–4½ weeks to tested, then two weeks per firm from access', validated: false, basis: 'Specification §11; not validated by a delivered implementation' },
    approval: { status: 'reviewed', by: 'Decision record A1–A6', on: '2026-11-06', note: 'Specification revision 2.1 approved; A1 conditional on Microsoft Graph testing.' },
    validation: 'untested', integrationGate: OUTLOOK_SPIKE_GATE, specRef: 'docs/archive/engineering/outlook-follow-up-drafts-spec.md (revision 2.1)',
  },
];

export const productionReady = (t: SolutionTemplate) => t.approval.status === 'reviewed' && t.validation === 'tested' && (!t.integrationGate || t.integrationGate.status === 'passed');
export function readiness(t: SolutionTemplate): { productionReady: boolean; label: string; reasons: string[] } {
  const reasons = [
    ...(t.approval.status !== 'reviewed' ? ['Design not yet reviewed by JADA'] : []),
    ...(t.validation !== 'tested' ? ['Not yet proven in a delivered implementation'] : []),
    ...(t.integrationGate && t.integrationGate.status !== 'passed' ? [`${t.integrationGate.description.split(':')[0]}: ${t.integrationGate.status === 'failed' ? 'failed' : 'not yet passed'}`] : []),
  ];
  return { productionReady: reasons.length === 0, reasons,
    label: reasons.length === 0 ? 'Production-ready' : t.approval.status === 'reviewed' ? 'Reviewed reference design, not production-ready' : 'Draft reference design, not production-ready' };
}

const rankOf = (m: TemplateMatch) => (m.readiness.productionReady ? 2 : 0) + (m.template.approval.status === 'reviewed' ? 1 : 0);
export interface TemplateMatch { template: SolutionTemplate; readiness: ReturnType<typeof readiness>; fit: string[] }
// Recommends templates only where both the problem and the classification fit. No match means custom engineering.
export function matchTemplates(o: { key: string; classification: Classification | null; systems: string[] }, list = SOLUTION_TEMPLATES): { matches: TemplateMatch[]; custom: boolean; reason: string } {
  if (!o.classification || o.classification === 'keep_human') return { matches: [], custom: false, reason: 'Keep human: not implemented as a change.' };
  const matches = list.filter((t) => t.painPointKeys.includes(o.key) && t.applicableClassifications.includes(o.classification!))
    .map((t) => ({ template: t, readiness: readiness(t), fit: [
      `Addresses this problem (${o.key.replace(/_/g, ' ')}) and the “${o.classification}” classification.`,
      ...(o.systems.length ? [`Systems named in discovery: ${o.systems.join(', ')}. Check against the template’s supported systems.`] : ['No systems were named in discovery: confirm the firm’s systems against the template.']),
    ] }))
    .sort((a, b) => rankOf(b) - rankOf(a) || a.template.id.localeCompare(b.template.id));
  return { matches, custom: matches.length === 0,
    reason: matches.length ? `${matches.length} reference template${matches.length === 1 ? '' : 's'} fit. None is production-ready unless labelled so.` : 'No reference template fits this problem and classification: custom engineering review required.' };
}
