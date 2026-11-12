// The saved demonstration firm: one SYNTHETIC UK mortgage brokerage taken through the complete discovery
// (firm context, nine people interviewed, findings, the firm lead's review, the report with its plans, and
// approved priorities). Used by the JADA admin page ("Create the demo firm") and by scripts/demo-seed.ts.
//
// Everything here is invented for demonstration. The firm, people, quotes and figures are not real, and
// every name says so. No outcome is recorded as achieved.
//
// Uses the application's own services (the same rules and audit trail as the live app). The administrator
// connection is used only for what the demo cannot do through an interview: completed interview sessions and
// the evidence they would have produced. Classification never calls the AI (the playbook, or the synthetic
// firm lead, sets it). The report's plans use the AI when `llmFor` is given, and the playbook otherwise.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool';
import { FirmService } from '../firm/service';
import { AnalysisService } from '../analysis/service';
import { DecisionService } from '../implementation/service';
import { ScriptedProvider } from '../llm/mock';
import { SEED_PLAYBOOK } from '../knowledge/playbook';
import type { LLMProvider } from '../llm/provider';

export const DEMO_FIRM = 'Synthetic Demo Mortgages (not a real firm)';
export const DEMO_LEAD = 'Demo Firm Lead (synthetic)';

export interface DemoFirmResult {
  lead: { orgId: string; userId: string }; discoveryId: string; engineerId: string; engineerName: string;
  findingIds: Record<string, string>; analysis: AnalysisService; decisions: DecisionService;
}

export async function createDemoFirm(db: Db, admin: pg.Pool, opts: { appBaseUrl: string; llmFor?: (s: { orgId: string; discoveryId: string }) => LLMProvider }): Promise<DemoFirmResult> {
  if ((await admin.query('select 1 from organisations where name = $1', [DEMO_FIRM])).rowCount) {
    throw Object.assign(new Error(`“${DEMO_FIRM}” already exists. Delete it first to create it again.`), { statusCode: 409 });
  }
  const FIRM = DEMO_FIRM;
  const appBaseUrl = opts.appBaseUrl;
  const firms = new FirmService(db, null, { appBaseUrl, invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  // No AI for classification: every model call fails, so it falls back to the playbook (labelled as such).
  const analysis = new AnalysisService(db, { providerFor: () => new ScriptedProvider({}), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl });
  const decisions = new DecisionService(db, { analysis, firms, playbook: SEED_PLAYBOOK, ...(opts.llmFor ? { llmFor: opts.llmFor } : {}) });

  // ---------------------------------------------------------------- firm, lead and JADA engineer
  const lead = { orgId: randomUUID(), userId: randomUUID() };
  await firms.createFirm({ ...lead, name: FIRM, leadUserId: lead.userId, leadName: 'Demo Firm Lead (synthetic)' });
  const engineerName = 'Demo Engineer (synthetic)';
  const engineerId = (await admin.query("select id from app_users where display_name = $1 and kind = 'jada'", [engineerName])).rows[0]?.id ?? randomUUID();
  await admin.query("insert into app_users (id, display_name, kind) values ($1, $2, 'jada') on conflict do nothing", [engineerId, engineerName]);
  await admin.query("insert into jada_staff_roles (user_id, role) values ($1, 'engineer') on conflict do nothing", [engineerId]);

  const discoveryId = await firms.createDiscovery(lead);
  await firms.saveProfile(lead, discoveryId, {
    advisers: 15, monthlyApplications: 120, typicalWeeksEnquiryToOffer: 7,
    businessStructure: 'SYNTHETIC DEMONSTRATION FIRM. Single office; 15 advisers supported by a case management team and administrators.',
    staffRoles: [{ role: 'firm_lead', count: 1 }, { role: 'adviser', count: 15 }, { role: 'case_manager', count: 6 }, { role: 'administrator', count: 3 }],
    systems: [], authorisation: 'directly_authorised',
    operationalChallenges: 'Synthetic example: cases stall waiting for client documents, and handovers between advisers and the case team lose information.',
    loadedHourlyCostGBP: 28,
    location: 'Synthetic location (demonstration only)',
    businessFocus: ['residential_purchase', 'remortgage_product_transfer', 'buy_to_let', 'protection'],
    operatingModel: 'advisers_with_case_managers',
    technology: [
      { name: 'Example CRM (synthetic)', category: 'crm_mortgage', purpose: 'Client and case records', teams: ['advisers', 'case_managers', 'administrators'], notes: '' },
      { name: 'Example sourcing tool (synthetic)', category: 'crm_mortgage', purpose: 'Product research', teams: ['advisers'], notes: '' },
      { name: 'Shared case mailbox', category: 'email_communication', purpose: 'Client and solicitor email', teams: ['case_managers', 'administrators'], notes: '' },
      { name: 'Lender portals', category: 'other', purpose: 'Submissions and case tracking', teams: ['advisers', 'case_managers'], notes: '' },
      { name: 'Document storage (synthetic)', category: 'document_management', purpose: 'Client documents', teams: ['case_managers', 'administrators'], notes: '' },
    ],
  });

  // ---------------------------------------------------------------- participants and completed interviews
  const PEOPLE: [string, string][] = [
    ['Demo Firm Lead (synthetic)', 'firm_lead'],
    ['Synthetic Adviser A', 'adviser'], ['Synthetic Adviser B', 'adviser'], ['Synthetic Adviser C', 'adviser'], ['Synthetic Adviser D', 'adviser'],
    ['Synthetic Case Manager A', 'case_manager'], ['Synthetic Case Manager B', 'case_manager'],
    ['Synthetic Administrator A', 'administrator'], ['Synthetic Administrator B', 'administrator'],
  ];
  for (const [name, role] of PEOPLE) await firms.inviteParticipant(lead, discoveryId, { name, role });
  // P1 = lead, P2–P5 advisers, P6–P7 case managers, P8–P9 administrators (pseudonyms are assigned in order).
  await admin.query(`update participants set consented_at = now() - interval '6 days', consent_version = 'consent-2026-11-v2' where discovery_id = $1`, [discoveryId]);
  await admin.query(`update invitations set first_used_at = now() - interval '6 days' where discovery_id = $1`, [discoveryId]);
  await admin.query(`insert into interview_sessions (id, org_id, discovery_id, participant_id, status, state, started_at, completed_at, kind)
    select gen_random_uuid(), p.org_id, p.discovery_id, p.id, 'completed', '{"transcript": [], "coverage": {}}'::jsonb, now() - interval '6 days', now() - interval '5 days', 'main'
      from participants p where p.discovery_id = $1`, [discoveryId]);

  type Ev = [string, string, string, string, string, number | null, number | null, string[], string | null, string | null, string, string?];
  // [pseudonym, key, stage, task, role, monthly volume, minutes, systems, cause, improvement, quote, source]
  const EVIDENCE: Ev[] = [
    // Automate: consistent accounts across three roles, plus a synthetic CRM count of cases waiting on documents.
    ['P6', 'document_chasing', 'documents', 'Chasing clients for payslips and bank statements', 'case_manager', 120, 20, ['Shared case mailbox'], 'Clients send documents in pieces', 'Reminders with a checklist of what is still missing', 'I chase most purchase cases two or three times before everything arrives'],
    ['P7', 'document_chasing', 'documents', 'Writing document chasers', 'case_manager', 110, 25, ['Shared case mailbox'], 'No checklist is sent at the start', null, 'Every chaser is a separate email I write from scratch'],
    ['P2', 'document_chasing', 'documents', 'Chasing documents when the case team is busy', 'adviser', 120, 15, ['Shared case mailbox'], null, null, 'When the case team is stretched I end up chasing documents myself'],
    ['P8', 'document_chasing', 'documents', 'Tracking outstanding documents', 'administrator', 120, 20, ['Example CRM (synthetic)'], 'Outstanding items tracked on a spreadsheet', null, 'I keep a spreadsheet of which documents are still outstanding'],
    // A record, not a person: attributed to the firm lead who supplied it, so it never counts towards another role's
    // quote-privacy threshold (see docs/archive/pilot-remediation-spec.md, finding P-1).
    ['rec1', 'document_chasing', 'documents', 'Cases waiting on documents last month (synthetic CRM report supplied by the firm lead)', 'firm_lead', 118, null, ['Example CRM (synthetic)'], null, null, 'Synthetic CRM report: 118 cases waited on at least one document last month', 'operational_record'],
    // Automate (playbook card): three advisers and a case manager agree.
    ['P3', 'case_status_updates', 'offer', 'Status update calls to clients and solicitors', 'adviser', 40, 10, ['Lender portals'], 'Status is only visible on lender portals', 'Milestone updates drafted for approval', 'Clients ring me for an update every few days once the case is with the lender'],
    ['P4', 'case_status_updates', 'offer', 'Answering progress queries', 'adviser', 40, 10, ['Lender portals'], 'No single view of case status', null, 'I spend a lot of time on update calls that say nothing has changed'],
    ['P5', 'case_status_updates', 'offer', 'Updating introducers and solicitors', 'adviser', 40, 10, ['Lender portals'], null, null, 'Solicitors chase us for updates we already gave the client'],
    ['P6', 'case_status_updates', 'offer', 'Progress updates to clients', 'case_manager', 40, 15, ['Lender portals'], null, null, 'Half my phone calls are someone asking where their case is'],
    // Overhaul: two roles describe the same handover very differently (10 vs 45 minutes).
    ['P3', 'application_handover', 'full_application', 'Handing a case to the case team', 'adviser', 50, 10, ['Example CRM (synthetic)'], 'No agreed handover note', null, 'The handover note is whatever I remember to write at the time'],
    ['P7', 'application_handover', 'full_application', 'Picking up cases from advisers', 'case_manager', 50, 45, ['Example CRM (synthetic)'], 'Information missing at handover', 'A standard handover checklist', 'Every handover means I re-ask the client for details the adviser already had'],
    // Fix: a configuration problem; two accounts, no figures given.
    ['P8', 'crm_duplicate_records', 'enquiry', 'Merging duplicate enquiry records', 'administrator', null, null, ['Example CRM (synthetic)'], 'Web form and CRM matching rule', 'Correct the matching rule', 'Web enquiries arrive in the CRM twice, so I merge duplicates every morning'],
    ['P9', 'crm_duplicate_records', 'enquiry', 'Finding the right enquiry record', 'administrator', null, null, ['Example CRM (synthetic)'], null, null, 'I cannot always tell which duplicate the adviser has been working on'],
    // Fix with a single account: ranked, but cannot go to engineering until corroborated.
    ['P5', 'lender_portal_logins', 'dip', 'Logging back in to lender portals', 'adviser', 30, 5, ['Lender portals'], null, null, 'One lender portal logs me out every few minutes during a DIP'],
    // Keep human: regulated judgement.
    ['P4', 'suitability_letter_drafting', 'recommendation', 'Writing suitability letters', 'adviser', 60, 45, [], null, null, 'The suitability letter needs my judgement on every case'],
    ['P5', 'suitability_letter_drafting', 'recommendation', 'Writing the recommendation', 'adviser', 60, 45, [], null, null, 'Each suitability letter is my advice, I would not hand that to anything else'],
    // Automate proposed at a regulated stage: held for compliance review whatever its size.
    ['P2', 'fact_find_rekeying', 'fact_find', 'Re-keying fact-find notes into the CRM', 'adviser', 90, 15, ['Example CRM (synthetic)'], null, null, 'After every meeting I re-key my fact-find notes into the CRM'],
    ['P3', 'fact_find_rekeying', 'fact_find', 'Typing up fact-find notes', 'adviser', 90, 15, ['Example CRM (synthetic)'], null, null, 'I rekey every fact find, usually in the evening'],
  ];
  for (const [p, key, stage, task, role, vol, mins, systems, cause, imp, quote, source] of EVIDENCE) {
    await admin.query(`insert into evidence_records (id, org_id, discovery_id, session_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role,
        monthly_volume, minutes_per_occurrence, systems, reported_cause, potential_improvement, supporting_quote)
      values ($1,$2,$3,(select s.id from interview_sessions s join participants pt on pt.id = s.participant_id where pt.discovery_id = $3 and pt.pseudonym = $4),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [randomUUID(), lead.orgId, discoveryId, p, source ?? 'firm_said', key, stage, task, role, vol, mins, systems, cause, imp, quote]);
  }

  // ---------------------------------------------------------------- analysis, firm-lead review and decisions
  await analysis.analyse(lead, discoveryId);
  const ids = async () => Object.fromEntries((await analysis.discoveryWorkspace(lead, discoveryId)).findings.map((f) => [f.key, f.id]));
  let pp = await ids();
  const correct = (key: string, field: string, value: unknown, reason: string) => analysis.correct(lead, discoveryId, pp[key]!, { field, value, reason });
  // Classifications the playbook couldn't suggest are set by the synthetic firm lead (shown as "Set by you").
  await correct('crm_duplicate_records', 'classification', 'fix', 'A CRM setting, not a new tool');
  await correct('application_handover', 'classification', 'overhaul', 'The handover process itself needs redesigning');
  await correct('lender_portal_logins', 'classification', 'fix', 'Likely a browser or portal setting');
  await correct('suitability_letter_drafting', 'classification', 'keep_human', 'Regulated advice stays with the adviser');
  await correct('fact_find_rekeying', 'classification', 'automate', 'Repetitive typing; worth assessing');
  // The two playbook suggestions are confirmed by the firm lead. Without a live AI the playbook fallback says
  // "the AI couldn't produce a classification", which reads as a fault in a demonstration; a confirmed
  // classification is also how a real discovery ends up.
  await correct('document_chasing', 'classification', 'automate', 'Repetitive, structured reminders; confirmed the industry suggestion');
  await correct('case_status_updates', 'classification', 'automate', 'Routine milestone updates; confirmed the industry suggestion');
  pp = await ids();
  // Every finding is validated ("this happens here"), so the overview reaches "Discovery complete". The two
  // regulated items stay held for compliance review or kept with people: validation doesn't change that.
  for (const k of Object.keys(pp)) await correct(k, 'validated', true, 'Confirmed with the team (synthetic)');
  // A business-case input from the firm: hours per case lets capacity be shown; no cash saving or cost is stated.
  await correct('document_chasing', 'staffHoursPerCase', 6, 'Synthetic firm estimate of staff hours per completed case');
  await analysis.completeDiscovery(lead, discoveryId, 'Synthetic demonstration discovery reviewed.');
  await decisions.createReport(lead, discoveryId);   // the fixed baseline report

  for (const k of ['document_chasing', 'crm_duplicate_records', 'application_handover']) {
    await analysis.recordOpportunityDecision(lead, discoveryId, pp[k]!, { decision: 'approved', reason: 'Agreed at the (synthetic) partners’ meeting' });
  }
  return { lead, discoveryId, engineerId, engineerName, findingIds: pp, analysis, decisions };
}
