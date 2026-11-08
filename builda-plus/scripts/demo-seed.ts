// Demonstration data: one SYNTHETIC UK mortgage brokerage taken through discovery, opportunities and JADA
// engineering, staged so every screen in docs/demo-runbook.md has something true to show.
//
// Everything here is invented for demonstration. The firm, people, quotes and figures are not real, and
// every name says so. No outcome is recorded as achieved: results stay "not yet measured".
//
// Uses the application's own services (the same rules, gates and audit trail as the live app). Raw SQL is
// used only for what the demo cannot do through an interview: completed interview sessions and the
// evidence they would have produced. AI is never called: classifications come from the playbook or are set
// by the (synthetic) firm lead, and are labelled that way in the app.
//
//   DATABASE_URL=postgres://builda_app:...@localhost/builda_demo \
//   DATABASE_ADMIN_URL=postgres://postgres@localhost/builda_demo \
//   DEMO_SEED=yes npx tsx scripts/demo-seed.ts
import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool';
import { FirmService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { DecisionService, JadaService } from '../src/implementation/service';
import { EngineeringService } from '../src/implementation/engineering';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { TEMPLATES } from '../src/knowledge/templates';

if (process.env.NODE_ENV === 'production') throw new Error('The demo seed never runs in production.');
if (process.env.DEMO_SEED !== 'yes') throw new Error('Set DEMO_SEED=yes to confirm this is a throwaway demonstration database.');
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('Set DATABASE_ADMIN_URL (administrator connection) for the demo database.');

const FIRM = 'Synthetic Demo Mortgages (not a real firm)';
const db = createPool();
const admin = new pg.Pool({ connectionString: adminUrl });
if ((await admin.query('select 1 from organisations where name = $1', [FIRM])).rowCount) {
  console.log(`“${FIRM}” already exists in this database. Use a fresh database to reseed.`);
  process.exit(0);
}

const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const firms = new FirmService(db, null, { appBaseUrl, invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
// No AI in the demo: every model call fails, so classification falls back to the playbook (labelled as such).
const analysis = new AnalysisService(db, { providerFor: () => new ScriptedProvider({}), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl });
const decisions = new DecisionService(db, { analysis, firms, playbook: SEED_PLAYBOOK });
const jada = new JadaService(db);
const engineering = new EngineeringService(db, { analysis, decisions });

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
await admin.query(`update participants set consented_at = now() - interval '6 days', consent_version = 'consent-2026-11-v1' where discovery_id = $1`, [discoveryId]);
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
  // quote-privacy threshold (see docs/pilot-remediation-spec.md, finding P-1).
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
for (const k of ['document_chasing', 'case_status_updates', 'crm_duplicate_records', 'application_handover', 'lender_portal_logins']) await correct(k, 'validated', true, 'Confirmed with the team (synthetic)');
// A business-case input from the firm: hours per case lets capacity be shown; no cash saving or cost is stated.
await correct('document_chasing', 'staffHoursPerCase', 6, 'Synthetic firm estimate of staff hours per completed case');
await analysis.completeDiscovery(lead, discoveryId, 'Synthetic demonstration discovery reviewed.');
await decisions.createReport(lead, discoveryId);   // the fixed baseline report

for (const k of ['document_chasing', 'crm_duplicate_records', 'application_handover']) {
  await analysis.recordOpportunityDecision(lead, discoveryId, pp[k]!, { decision: 'approved', reason: 'Agreed at the (synthetic) partners’ meeting' });
}
const packs: Record<string, string> = {};
for (const k of ['document_chasing', 'crm_duplicate_records', 'application_handover']) {
  packs[k] = (await engineering.submit(lead, discoveryId, pp[k]!, 'Synthetic demonstration submission')).packId;
}

// ---------------------------------------------------------------- JADA engineering
await jada.pickUp(engineerId, discoveryId);
const act = (k: string, action: string, input: unknown = {}) => engineering.act(engineerId, packs[k]!, action, input);
const tpl = TEMPLATES.find((t) => t.id === 'document_chasing_v1')!;
const none = { operational: [], security: [], regulatory: [], privacy: [], technical: [] };

// Automate: designed on the (untested) reference template, approved, planned and in progress. Not completed.
await act('document_chasing', 'start_assessment');
await act('document_chasing', 'record_design', {
  templateId: 'document_chasing_v1', approach: 'conventional_automation',
  rationale: 'Structured, repetitive reminders: rules and approved wording are enough; no AI is needed.',
  systems: ['Example CRM (synthetic)', 'Shared case mailbox'], dependencies: ['An export of outstanding documents per case from the CRM'],
  humanApprovalPoints: tpl.spec.humanApprovalPoints,
  requirements: {
    functional: tpl.spec.targetProcess.slice(0, 5), nonFunctional: ['Reminders drafted within one working day of being due'],
    data: ['Case reference and outstanding-document list only; no client documents'], integration: ['CRM export (daily) until an API is confirmed'],
    access: tpl.spec.accessRequirements.slice(0, 3), security: ['Client data stays in the firm’s systems; the automation keeps case references only'],
    errorHandling: ['If the export is missing, no reminders are drafted and the case team is told'], logging: ['Every draft, approval and send is logged with who and when'],
    acceptance: tpl.spec.definitionOfDone,
  },
  risks: { ...none, operational: ['If the outstanding-documents list is wrong, reminders will be wrong (mitigated by staff approval)'], technical: tpl.spec.standardRisks.slice(0, 1) },
  outstandingDecisions: [],
});
await act('document_chasing', 'two_week_check', { checks: { singleWorkflowWithStartAndFinish: true, changesCoreSystems: false, accessAndTestDataReadyDayOne: false,
  humanApprovalForCommsAndRecordChanges: true, complianceQuestionsResolved: true }, unresolvedDependencies: ['CRM export format not yet confirmed'] });
await act('document_chasing', 'approve_for_implementation', { note: 'Approved on the draft template; the first implementation will test it.' });
await act('document_chasing', 'record_plan', {
  scope: 'One workflow: chasing outstanding documents on new purchase cases, from “waiting for documents” to all received or handed back.',
  deliverables: ['Reminder drafting from approved wording', 'Approval queue for the case team', 'Weekly stalled-cases list'],
  dependencies: ['CRM export of outstanding documents'], unresolvedDependencies: ['CRM export format not yet confirmed'],
  requiredAccess: ['CRM export', 'Firm-approved sending mailbox', 'Dummy test cases'], accessConfirmed: false,
  testingPlan: tpl.spec.testCases.map((t) => t.name), acceptanceCriteria: tpl.spec.definitionOfDone,
  responsibleParties: [{ party: 'JADA engineer', responsibility: 'Build and test on dummy data' }, { party: 'Firm lead', responsibility: 'Approve reminder wording and confirm access' }],
  duration: null,
  successMeasures: [
    { name: 'Case-team hours a month chasing documents', valueType: 'time', unit: 'hours / month', baseline: 40, baselineSource: 'Discovery estimate: 120 a month × 20 minutes (middle of 4 accounts)',
      target: 28, direction: 'decrease', measurementSource: 'Weekly two-question pulse to the case team', period: '4 weeks after go-live' },
    { name: 'Additional cases handled a month', valueType: 'capacity', unit: 'cases / month', baseline: null, baselineSource: 'Not yet measured',
      target: null, direction: 'increase', measurementSource: 'Completed cases in the CRM', period: '3 months after go-live' },
  ],
});
await act('document_chasing', 'start_implementation', { note: 'Build on dummy data while the CRM export is confirmed.' });

// Fix: custom design, approved, planned; implementation not started.
await act('crm_duplicate_records', 'start_assessment');
await act('crm_duplicate_records', 'record_design', {
  templateId: null, approach: 'process_or_configuration_fix', rationale: 'A CRM matching-rule setting creates the duplicates; correcting it needs no new tool.',
  systems: ['Example CRM (synthetic)'], dependencies: ['CRM administrator access'], humanApprovalPoints: [],
  requirements: { functional: ['One CRM record per web enquiry'], nonFunctional: [], data: [], integration: ['Web enquiry form → CRM'], access: ['CRM administrator access for one session'],
    security: [], errorHandling: ['If a duplicate still appears, it is flagged rather than merged automatically'], logging: [], acceptance: ['No duplicate records from web enquiries over two weeks'] },
  risks: { ...none, operational: ['Existing duplicates still need a one-off clean-up by the administrators'] }, outstandingDecisions: [],
});
await act('crm_duplicate_records', 'approve_for_implementation', { note: 'Small configuration change.' });
await act('crm_duplicate_records', 'record_plan', {
  scope: 'Correct the web-enquiry matching rule in the CRM and confirm with the administrators.', deliverables: ['Corrected matching rule', 'Short note for the administrators'],
  dependencies: [], unresolvedDependencies: [], requiredAccess: ['CRM administrator access'], accessConfirmed: true,
  testingPlan: ['Submit ten test enquiries through the web form'], acceptanceCriteria: ['No duplicate records from web enquiries over two weeks'],
  responsibleParties: [{ party: 'JADA engineer', responsibility: 'Change and test the rule' }, { party: 'Administrator', responsibility: 'Confirm over two weeks' }],
  duration: null,
  // Administrators gave no figures, so there is no baseline yet and no target is invented: both are agreed in week one.
  successMeasures: [{ name: 'Administrator time merging duplicate records', valueType: 'time', unit: 'minutes / week', baseline: null, baselineSource: 'To be timed by the administrators in week one',
    target: null, direction: 'decrease', measurementSource: 'Administrators’ weekly log', period: 'Two weeks after the change' }],
});

// Overhaul: engineering needs more information from the firm (answered live in the demo).
await act('application_handover', 'start_assessment');
await act('application_handover', 'request_information', { questions: ['Which details are most often missing when a case reaches the case team?', 'Is there a handover template today, even an informal one?'] });

await db.end(); await admin.end();
console.log(`\nSynthetic demonstration data created for “${FIRM}”.`);
console.log(`Sign in at ${appBaseUrl}/signin as “Demo Firm Lead (synthetic)” or “${engineerName}”. See docs/demo-runbook.md.\n`);
