import { ROLE_LABELS, type Classification } from '../domain/journey';
import type { FirmProfile } from '../firm/profile';
import type { Playback } from '../analysis/service';
import { templateFor } from '../knowledge/templates';
import { agentFor } from '../knowledge/agents';
import type { Playbook } from '../knowledge/playbook';
import { checksFor } from '../knowledge/model';
import { COMPLEXITY_BY_KIND, type SolutionPlan } from './plans';

// Firm discovery report (brief §12.1). Assembled by code from stored findings — no AI.
export const CLASS_LABEL: Record<Classification, string> = { overhaul: 'Overhaul the process', fix: 'Fix without automation', automate: 'Automate with human approval', keep_human: 'Keep with people' };
export const CONF_LABEL: Record<string, string> = { insufficient: 'Not enough evidence', low: 'Low', medium: 'Medium', high: 'High', very_high: 'Very high' };
const num = (x: number | null | undefined, unit = '') => (x === null || x === undefined ? 'Unknown' : `${x.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${unit}`);

export interface BusinessCase {
  rank: number; title: string; stage: string; approach: string; confidence: string;
  currentProcess: string[]; evidence: { role: string; quote: string }[];
  figures: { label: string; value: string }[];
  improvement: string[]; complexity: string; assumptions: string[]; payback: string; unknowns: string[];
  requiresComplianceReview: boolean;
  plan?: SolutionPlan;            // the concrete plan: what we build, how, before/after, timeline
}

// An AI agent recommendation (from the agent catalogue, matched by a fixed rule): what it does, what stays
// with people, and the same figures and evidence rating as any other opportunity.
export interface AgentCard {
  name: string; summary: string; does: string[]; staysWithPeople: string[]; neverDoes: string[];
  regulatedStep: boolean; reviewed: boolean;
  problem: string; stage: string; priorityRank: number | null; confidence: string;
  figures: { label: string; value: string }[]; evidence: { role: string; quote: string }[];
  unknowns: string[]; requiresComplianceReview: boolean;
  plan?: SolutionPlan;
}

// The market proposition: what JADA builds, by when, and how the firm will see the difference.
export interface Offer { headline: string; lead: string; items: { title: string; deliver: string; when: string; measure: string }[]; conditions: string[] }

export interface ReportModel {
  firmName: string; discoveryId: string; generatedAt: string; version: number;
  scoringConfigVersion: string;
  summary: string[];
  profile: { label: string; value: string }[];
  participation: { role: string; completed: number; total: number }[];
  journey: { stage: string; regulated: boolean; painPoints: string[] }[];
  agents?: AgentCard[];            // AI agents first; absent on reports made before the catalogue existed
  businessCases: BusinessCase[];    // the other top improvements (process automation, fixes, overhauls)
  otherFindings: { title: string; stage: string; approach: string; confidence: string; note: string }[];
  crossRole: { agreements: string[]; differences: { title: string; detail: string }[]; blindSpots: string[] | null; unreportedStages: string[] };
  recommendedBuild: { title: string | null; status: 'provisional' | 'blocked' | 'none'; text: string; blockers: string[]; toConfirm: string[] };
  offer?: Offer;
  regulatoryReview: string[];
  regulatoryItems: { title: string; stage: string; checks: { title: string; requiredAction: string; citations: string[] }[]; notCovered: boolean }[];
  knowledge: { version: string; reviewed: boolean };
  sourcesCited: string[];
  outstandingQuestions: string[];
  toProceed: string[];
  disclaimers: string[];
}

export function buildReportModel(p: { playback: Playback; profile: FirmProfile | null; firmName: string; discoveryId: string; version: number; now?: Date; playbook?: Playbook; plans?: Map<string, SolutionPlan> }): ReportModel {
  const { playback: pb, profile } = p;
  const byId = new Map(pb.painPoints.map((x) => [x.id, x]));
  // AI agents come first in the report: every ranked or held problem that an agent in the catalogue covers,
  // in priority order. They keep their own evidence rating, so a weak one never reads as certain.
  const agentItems = pb.painPoints.map((x) => ({ x, agent: agentFor(x.key, x.classification) })).filter((a) => a.agent);
  const agentIds = new Set(agentItems.map((a) => a.x.id));
  const top = pb.topThree.map((id) => byId.get(id)!).filter(Boolean).filter((x) => !agentIds.has(x.id));
  const money = (v: number | null | undefined) => (v === null || v === undefined ? 'Unknown' : `£${v.toLocaleString('en-GB')}`);
  const agents: AgentCard[] = agentItems.map(({ x, agent }) => ({
    name: agent!.name, summary: agent!.summary, does: agent!.does, staysWithPeople: agent!.staysWithPeople, neverDoes: agent!.neverDoes,
    regulatedStep: agent!.regulatedStep, reviewed: agent!.reviewed,
    problem: x.title, stage: x.stageName, priorityRank: x.rank ?? null, confidence: CONF_LABEL[x.confidence] ?? x.confidence,
    figures: [
      { label: 'Staff hours spent per month', value: num(x.impact?.monthlyHoursSpent) },
      { label: 'Hours it could free up per month', value: x.impact?.monthlyHoursSpent != null && x.impact?.monthlyHoursRecovered == null ? 'Not estimated yet' : num(x.impact?.monthlyHoursRecovered) },
      { label: 'Value of that time per month', value: money(x.impact?.monthlyCapacityValueGBP) },
    ],
    evidence: x.quotes.slice(0, 2), unknowns: x.impact?.unknowns ?? [],
    requiresComplianceReview: x.requiresComplianceReview || agent!.regulatedStep,
    ...(p.plans?.get(x.id) ? { plan: p.plans.get(x.id)! } : {}),
  }));
  const titleOf = (key: string) => pb.painPoints.find((x) => x.key === key)?.title ?? key;

  const businessCases: BusinessCase[] = top.map((x, i) => {
    const template = x.classification === 'automate' ? templateFor(x.key) : null;
    const value = x.impact?.monthlyCapacityValueGBP ?? null;
    return {
      rank: i + 1, title: x.title, stage: x.stageName,
      approach: x.classification ? CLASS_LABEL[x.classification] : 'Not yet classified',
      confidence: CONF_LABEL[x.confidence] ?? x.confidence,
      currentProcess: [
        `Reported by ${x.roles.join(', ') || 'participants'} (${x.participantCount} ${x.participantCount === 1 ? 'person' : 'people'}).`,
        ...x.causes.map((c: string) => `Reported cause: ${c}`),
        ...x.disagreements.map((d: any) => `Accounts differed — ${d.field === 'minutesPerOccurrence' ? 'minutes each time' : 'monthly volume'}: ${d.values.map((v: any) => `${v.role} ${num(v.value)}`).join('; ')}. The figures below use the middle value, and this lowers the evidence rating until it’s confirmed.`),
      ],
      evidence: x.quotes.slice(0, 3),
      figures: [
        { label: 'Monthly volume', value: num(x.overrides.monthlyVolume ?? x.volume?.value) },
        { label: 'Minutes each time', value: num(x.overrides.minutesPerOccurrence ?? x.minutes?.value) },
        { label: 'Staff hours spent per month', value: num(x.impact?.monthlyHoursSpent) },
        { label: 'Hours that could be recovered per month', value: num(x.impact?.monthlyHoursRecovered) },
        { label: 'Value of recovered capacity per month', value: value === null ? 'Unknown' : `£${value.toLocaleString('en-GB')}` },
      ],
      improvement: x.improvements.length ? x.improvements : [x.classification ? CLASS_LABEL[x.classification] : 'To be agreed'],
      complexity: template ? `${template.typicalComplexity[0]!.toUpperCase()}${template.typicalComplexity.slice(1)} — based on the JADA template “${template.name}”`
        : (p.plans?.get(x.id) && x.classification && COMPLEXITY_BY_KIND[x.classification as Classification]) || 'Not yet assessed',
      assumptions: x.assumptions,
      // Phase 4: the business case's own reason; unchanged default when it hasn't been worked out.
      payback: x.impact?.businessCase?.payback?.months != null ? `${x.impact.businessCase.payback.months} months — ${x.impact.businessCase.payback.reason}`
        : x.impact?.businessCase?.inputs?.implementationCostGBP?.value != null
          ? (x.impact.businessCase.payback.reason as string).replace(/^Not calculated: /, 'Not calculated — ')
          : 'Not calculated — implementation cost is not yet known.',
      unknowns: x.impact?.unknowns ?? [],
      requiresComplianceReview: x.requiresComplianceReview,
      ...(p.plans?.get(x.id) ? { plan: p.plans.get(x.id)! } : {}),
    };
  });

  // The offer leads with an agent that can start now (not held for compliance review), then everything else planned.
  const planned = [
    ...agents.filter((a) => a.plan && !a.requiresComplianceReview).map((a) => ({ title: a.name, plan: a.plan!, automate: true })),
    ...businessCases.filter((b) => b.plan).map((b) => ({ title: b.title, plan: b.plan!, automate: /automate/i.test(b.approach) })),
  ];
  const first = planned.find((b) => b.automate) ?? planned[0];
  const offer: Offer | undefined = first ? {
    headline: 'What JADA will build for you',
    lead: `Start with “${first.title.replace(/\.$/, '')}”: ${first.plan.timeline.headline.charAt(0).toLowerCase()}${first.plan.timeline.headline.slice(1)}. ${first.plan.headline}`,
    items: planned.map((b) => ({ title: b.title, deliver: b.plan.headline, when: b.plan.timeline.headline, measure: b.plan.measures[0] ?? 'Measured before and after' })),
    conditions: [
      'A 30-minute scoping call first, to confirm access to your systems and the sample cases we test with.',
      'Nothing reaches a client without your team’s approval, and regulated advice always stays with your advisers.',
      'We measure before and after, so you see the difference in your own figures.',
    ],
  } : undefined;

  const candidate = [...agentItems.map((a) => a.x), ...top].find((x) => x.classification === 'automate' && !x.requiresComplianceReview) ?? null;
  const recommendedBuild: ReportModel['recommendedBuild'] = !candidate
    ? { title: null, status: 'none', text: 'None of the top opportunities is suited to automation yet. The first improvements are process changes the firm can make directly.', blockers: [], toConfirm: [] }
    : {
        title: candidate.title,
        status: candidate.twoWeek?.status === 'provisional' ? 'provisional' : 'blocked',
        text: candidate.twoWeek?.status === 'provisional'
          ? `“${candidate.title}” is provisionally suitable for a two-week build, subject to JADA engineering review.`
          : `“${candidate.title}” is the strongest automation candidate, but it does not yet meet the two-week criteria.`,
        blockers: candidate.twoWeek?.blockers ?? [],
        toConfirm: candidate.twoWeek?.toConfirmInEngineeringReview ?? [],
      };

  // Regulatory checks from the approved knowledge base, with citations; gaps are stated, not filled.
  const kb: Playbook = p.playbook ?? { version: 'unknown', cards: [], reviewed: false };
  const regulatoryItems = pb.painPoints
    .map((x) => ({ x, applied: checksFor(kb, x.stageId, x.classification) }))
    .filter(({ x, applied }) => x.requiresComplianceReview || applied.length > 0)
    .map(({ x, applied }) => ({
      title: x.title, stage: x.stageName,
      checks: applied.map((a) => ({ title: a.check.title, requiredAction: a.check.requiredAction, citations: a.citations })),
      notCovered: x.requiresComplianceReview && applied.length === 0,
    }));
  const sourcesCited = [...new Set(regulatoryItems.flatMap((r) => r.checks.flatMap((c) => c.citations)))];

  const roles = new Map<string, { completed: number; total: number }>();
  for (const r of pb.participation) {
    const e = roles.get(r.role) ?? { completed: 0, total: 0 };
    e.total += 1; if (r.status === 'completed') e.completed += 1;
    roles.set(r.role, e);
  }
  const completed = pb.participation.filter((r) => r.status === 'completed').length;

  const toProceed = [
    ...pb.painPoints.filter((x) => x.missingMeasurements.length > 0).map((x) => `Approximate figures for “${x.title}”.`),
    ...pb.painPoints.filter((x) => !x.validated && pb.topThree.includes(x.id)).map((x) => `Your confirmation that “${x.title}” is described accurately.`),
    ...(profile?.loadedHourlyCostGBP ? [] : ['An approximate hourly staff cost, if you want recovered time expressed in pounds.']),
    ...(candidate ? ['Implementation cost, once JADA has scoped the build, to calculate payback.'] : []),
  ];

  return {
    firmName: p.firmName, discoveryId: p.discoveryId, version: p.version,
    generatedAt: (p.now ?? new Date()).toISOString(), scoringConfigVersion: pb.scoringConfigVersion,
    summary: [
      ...(agents.length ? [`${agents.length === 1 ? 'One AI agent' : `${agents.length} AI agents`} could take on work your team does by hand today: ${agents.map((a) => a.name).join(', ')}. Each works with a person approving what it does.`] : []),
      `${completed} of ${pb.participation.length} people completed an interview.`,
      `${pb.painPoints.length} operational pain point${pb.painPoints.length === 1 ? '' : 's'} identified across ${new Set(pb.painPoints.map((x) => x.stageId)).size} stage${new Set(pb.painPoints.map((x) => x.stageId)).size === 1 ? '' : 's'} of the mortgage journey.`,
      ...(pb.topThree[0] && byId.get(pb.topThree[0]) ? ((t) => [`Top opportunity by value: ${t.title} — ${num(t.impact?.monthlyHoursRecovered)} hours a month could be recovered (evidence: ${(CONF_LABEL[t.confidence] ?? t.confidence).toLowerCase()}).`])(byId.get(pb.topThree[0])!) : []),
      ...(pb.crossRole && pb.crossRole.disagreements.length ? [`Accounts differed on ${pb.crossRole.disagreements.length} item${pb.crossRole.disagreements.length === 1 ? '' : 's'}; these are shown side by side rather than averaged away.`] : []),
    ],
    profile: profile ? [
      { label: 'Advisers', value: String(profile.advisers) },
      { label: 'Applications per month', value: num(profile.monthlyApplications) },
      { label: 'Typical weeks from enquiry to offer', value: num(profile.typicalWeeksEnquiryToOffer) },
      { label: 'Authorisation', value: { directly_authorised: 'Directly authorised', network_appointed_representative: 'Appointed representative of a network', unsure: 'Not stated' }[profile.authorisation] },
      { label: 'Systems', value: profile.systems.join(', ') || 'Not stated' },
      { label: 'Structure', value: profile.businessStructure || 'Not stated' },
      ...(profile.otherRoles?.length ? [{ label: 'Other roles', value: profile.otherRoles.map((r) => `${r.name} (${r.count})`).join(', ') }] : []),
      ...(profile.notes?.trim() ? [{ label: 'Notes', value: profile.notes.trim() }] : []),
    ] : [],
    participation: [...roles.entries()].map(([role, v]) => ({ role, ...v })),
    journey: pb.journey.map((s) => ({ stage: s.name, regulated: s.regulatedJudgement, painPoints: s.painPoints.map((id) => byId.get(id)!.title) })),
    agents,
    businessCases,
    otherFindings: pb.painPoints.filter((x) => !pb.topThree.includes(x.id) && !agentIds.has(x.id)).map((x) => ({
      title: x.title, stage: x.stageName, approach: x.classification ? CLASS_LABEL[x.classification] : 'Not yet classified',
      confidence: CONF_LABEL[x.confidence] ?? x.confidence, note: x.twoWeek?.excludedReason ?? '',
    })),
    crossRole: {
      agreements: (pb.crossRole?.agreements ?? []).map(titleOf),
      differences: pb.painPoints.filter((x) => x.disagreements.length).map((x) => ({
        title: x.title,
        detail: x.disagreements.map((d: any) => `${d.field === 'minutesPerOccurrence' ? 'Minutes each time' : 'Monthly volume'}: ${d.values.map((v: any) => `${v.role} ${num(v.value)}`).join('; ')}`).join('. '),
      })),
      blindSpots: pb.crossRole?.firmLeadInterviewed ? pb.crossRole.blindSpots.map(titleOf) : null,
      unreportedStages: pb.crossRole?.unreportedStages ?? [],
    },
    recommendedBuild,
    regulatoryReview: [
      ...pb.painPoints.filter((x) => x.requiresComplianceReview).map((x) => `“${x.title}” sits at a stage involving regulated judgement (${x.stageName}). Any change must be reviewed by a qualified compliance professional, and automation may only prepare information for the adviser.`),
      'Protection advice is a separate advised sale and is not automated.',
    ],
    regulatoryItems,
    ...(offer ? { offer } : {}),
    knowledge: { version: kb.version, reviewed: kb.reviewed === true },
    sourcesCited,
    outstandingQuestions: [...new Set(pb.painPoints.flatMap((x) => x.outstandingQuestions))].slice(0, 15),
    toProceed,
    disclaimers: [
      ...(kb.reviewed ? [`Based on knowledge release ${kb.version}, approved by a qualified compliance reviewer.`]
        : [`WARNING: produced with an unreviewed development playbook (${kb.version}). Not for use with a real firm.`]),
      'This report describes how work is done at the firm, based on what staff told us. Figures are their estimates unless marked otherwise, and are labelled with how strong the evidence is.',
      'It is not mortgage advice, legal advice or a compliance opinion, and it is not approved by the FCA. Regulatory points must be reviewed by a qualified compliance professional.',
      'Individual answers are shown by role, not by name. Recovered staff hours are operational capacity, not a guaranteed cost saving.',
    ],
  };
}

export { ROLE_LABELS };
