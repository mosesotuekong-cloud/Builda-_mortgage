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
import { createPool } from '../src/db/pool';
import { createDemoFirm, DEMO_FIRM } from '../src/admin/demoFirm';
import { JadaService } from '../src/implementation/service';
import { EngineeringService } from '../src/implementation/engineering';
import { TEMPLATES } from '../src/knowledge/templates';

if (process.env.NODE_ENV === 'production') throw new Error('The demo seed never runs in production.');
if (process.env.DEMO_SEED !== 'yes') throw new Error('Set DEMO_SEED=yes to confirm this is a throwaway demonstration database.');
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('Set DATABASE_ADMIN_URL (administrator connection) for the demo database.');

const db = createPool();
const admin = new pg.Pool({ connectionString: adminUrl });
if ((await admin.query('select 1 from organisations where name = $1', [DEMO_FIRM])).rowCount) {
  console.log(`“${DEMO_FIRM}” already exists in this database. Use a fresh database to reseed.`);
  process.exit(0);
}

const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const FIRM = DEMO_FIRM;
const { lead, discoveryId, engineerId, engineerName, findingIds: pp, analysis, decisions } = await createDemoFirm(db, admin, { appBaseUrl });
const jada = new JadaService(db);
const engineering = new EngineeringService(db, { analysis, decisions });

// The discovery ends here. The engineering stages below are parked; they're seeded only with LATER_STAGES=on.
if (process.env.LATER_STAGES !== 'on') {
  await db.end(); await admin.end();
  console.log(`\nSynthetic demonstration data created for “${FIRM}”.`);
  console.log(`Sign in at ${appBaseUrl}/signin as “Demo Firm Lead (synthetic)”. See docs/demo-runbook.md.\n`);
  process.exit(0);
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
