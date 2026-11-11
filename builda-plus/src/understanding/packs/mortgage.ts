import { STAGES, STAGE_IDS, ROLES, ROLE_LABELS, DEFAULT_STAGES_BY_ROLE } from '../../domain/journey';
import { SEED_PLAYBOOK } from '../../knowledge/playbook';
import type { DomainPack, PackType } from '../pack';

// The first domain pack: UK mortgage brokerage. Built from the existing journey and playbook, so the
// interview engine and the knowledge model share one source. Types are DRAFTS, like the playbook cards:
// they need review by a mortgage or compliance owner before use with real firms.
const t = (id: string, label: string, stage: string, roles: string[], synonyms: string[] = []): PackType => ({ id, label, stage, roles, synonyms });

const ACTIVITY_TYPES: PackType[] = [
  t('take_enquiry', 'Take a new enquiry', 'enquiry', ['adviser', 'administrator'], ['new lead', 'first call', 'web enquiry']),
  t('log_enquiry', 'Log an enquiry in the CRM', 'enquiry', ['administrator'], ['enter the enquiry', 'set up the client record']),
  t('send_initial_disclosure', 'Send initial disclosure documents', 'disclosure_id', ['administrator', 'adviser'], ['terms of business', 'IDD']),
  t('verify_identity', 'Check identity and anti-money-laundering', 'disclosure_id', ['administrator', 'case_manager', 'adviser'], ['ID check', 'AML', 'KYC']),
  t('complete_fact_find', 'Complete the fact-find with the client', 'fact_find', ['adviser'], ['fact find meeting', 'gather client details']),
  t('record_fact_find', 'Record fact-find details in the CRM', 'fact_find', ['adviser', 'administrator'], ['type up the fact-find', 're-key the fact find', 'enter the fact-find']),
  t('check_fact_find', 'Check fact-find information', 'fact_find', ['administrator', 'case_manager'], ['review the fact-find']),
  t('request_documents', 'Request documents from the client', 'documents', ['case_manager', 'administrator', 'adviser'], ['ask for payslips', 'document request']),
  t('chase_documents', 'Chase the client for outstanding documents', 'documents', ['case_manager', 'administrator', 'adviser'], ['chasing documents', 'chase payslips']),
  t('file_documents', 'File documents received from the client', 'documents', ['administrator', 'case_manager'], ['save documents', 'upload documents']),
  t('track_documents', 'Track which documents are outstanding', 'documents', ['case_manager', 'administrator'], ['document tracker']),
  t('research_products', 'Research products and affordability', 'research_affordability', ['adviser'], ['sourcing', 'run the sourcing system', 'affordability check']),
  t('obtain_dip', 'Obtain a decision in principle', 'dip', ['adviser', 'case_manager'], ['DIP', 'AIP', 'agreement in principle']),
  t('log_into_lender_portal', 'Log in to lender portals', 'dip', ['adviser', 'case_manager'], ['portal login']),
  t('write_suitability_letter', 'Write the suitability letter', 'recommendation', ['adviser'], ['recommendation letter', 'reasons why letter']),
  t('quote_protection', 'Obtain protection quotes', 'protection', ['adviser'], ['life cover quotes', 'insurance quotes']),
  t('submit_application', 'Submit the full application', 'full_application', ['adviser', 'case_manager'], ['key the application', 'submit to lender']),
  t('hand_over_case', 'Hand the case to the case team', 'full_application', ['adviser', 'case_manager'], ['handover', 'pass the case on', 'pick up the case']),
  t('answer_lender_queries', 'Answer lender and underwriter queries', 'valuation_underwriting', ['case_manager', 'adviser'], ['underwriter queries', 'conditions']),
  t('track_valuation', 'Track the valuation', 'valuation_underwriting', ['case_manager'], ['chase the valuation']),
  t('update_parties', 'Update clients, solicitors and introducers on progress', 'offer', ['case_manager', 'administrator'], ['progress updates', 'status updates', 'keep everyone updated']),
  t('process_offer', 'Process the mortgage offer', 'offer', ['case_manager', 'administrator'], ['check the offer', 'file the offer']),
  t('chase_solicitors', 'Chase solicitors for progress', 'legal_exchange', ['case_manager', 'administrator'], ['solicitor updates', 'conveyancer chasing']),
  t('complete_case', 'Complete the case', 'completion', ['case_manager', 'administrator'], ['completion letter', 'close the case']),
  t('track_product_expiry', 'Track product expiries for renewals', 'aftercare_renewal', ['adviser', 'administrator'], ['renewals', 'product transfer reminders', 'remortgage reminders']),
];

const INFORMATION_TYPES: PackType[] = [
  t('identity_documents', 'Identity documents', 'disclosure_id', [], ['ID', 'passport', 'driving licence', 'proof of address']),
  t('fact_find', 'Fact-find', 'fact_find', [], ['fact find', 'client details']),
  t('payslips', 'Payslips', 'documents', [], ['wage slips', 'pay slips']),
  t('bank_statements', 'Bank statements', 'documents', [], ['statements']),
  t('self_employed_accounts', 'Self-employed accounts', 'documents', [], ['SA302', 'tax calculations', 'accounts']),
  t('client_documents', 'Client documents', 'documents', [], ['documents', 'paperwork']),
  t('dip_certificate', 'Decision in principle', 'dip', [], ['DIP certificate', 'AIP']),
  t('research_output', 'Sourcing and affordability results', 'research_affordability', [], ['sourcing results', 'research']),
  t('suitability_letter', 'Suitability letter', 'recommendation', [], ['recommendation letter']),
  t('handover_note', 'Handover note', 'full_application', [], ['handover notes', 'case notes']),
  t('application_form', 'Application', 'full_application', [], ['application details']),
  t('valuation_report', 'Valuation report', 'valuation_underwriting', [], ['valuation']),
  t('mortgage_offer', 'Mortgage offer', 'offer', [], ['offer']),
  t('crm_notes', 'CRM notes', 'enquiry', [], ['notes', 'case notes in the CRM']),
];

export const MORTGAGE_PACK: DomainPack = {
  id: 'uk_mortgage_brokerage',
  version: '2026.11-draft',
  name: 'UK mortgage brokerage',
  stages: STAGE_IDS.map((id) => ({ id, name: STAGES[id].name, regulated: STAGES[id].regulatedJudgement })),
  roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id], stages: [...DEFAULT_STAGES_BY_ROLE[id]] })),
  activityTypes: ACTIVITY_TYPES,
  informationTypes: INFORMATION_TYPES,
  parties: [
    { id: 'client', label: 'the client' }, { id: 'lender', label: 'the lender' }, { id: 'underwriter', label: 'the underwriter' },
    { id: 'solicitor', label: 'the solicitor or conveyancer' }, { id: 'introducer', label: 'an introducer' }, { id: 'network', label: 'the network' },
    { id: 'valuer', label: 'the valuer' }, { id: 'estate_agent', label: 'the estate agent' }, { id: 'insurer', label: 'the insurer' },
  ],
  problemPatterns: SEED_PLAYBOOK.cards,
  adviceBoundary: 'Never give mortgage advice, never comment on a real client case, never ask for client names or case details. At stages involving regulated judgement, ask only about the admin and preparation around the advice, never about advice decisions.',
};
