import type { Classification, Role, StageId } from '../domain/journey';

// Pain-point cards (brief §5.3). These seeds are DRAFTS: they must be reviewed by a
// named mortgage/compliance owner before use with real firms.
export interface PlaybookCard {
  id: string;
  title: string;
  stageId: StageId;
  roles: Role[];
  signs: string[];
  interviewQuestions: string[];
  infoToCollect: string[];
  metrics: string[];
  likelyClassification: Classification;
  automationPatterns: string[];
  humanApproval: string[];
  regulatoryLimits: string[];
  owner: string;
  lastReviewed: string | null;
  sourceRefs?: SourceRef[];
}

export interface SourceRef { sourceKey: string; section: string }

// UK regulatory checks (brief §9.3): approved statements, with sources, about what must happen
// before anything at a given stage changes. Enforcement stays in code; these explain and cite.
export interface RegulatoryCheck {
  key: string;
  title: string;
  statement: string;
  appliesToStages: StageId[];
  appliesTo: 'any_change' | 'automation';
  requiredAction: string;
  sourceRefs: SourceRef[];
  owner: string;
  lastReviewed: string | null;
}

export interface SourceSnapshot {
  key: string; title: string; reference: string; publisher: string; updatedOn: string;
  sections: string[]; summary: string; owner: string; lastReviewed: string | null;
}

export interface Playbook {
  version: string;
  cards: PlaybookCard[];
  checks?: RegulatoryCheck[];
  sources?: SourceSnapshot[];
  reviewed?: boolean;            // false for the development seed; true only for published releases
}

export const SEED_PLAYBOOK: Playbook = {
  version: '0.1.0-draft',
  reviewed: false,
  cards: [
    {
      id: 'document_chasing',
      title: 'Manual chasing of outstanding client documents',
      stageId: 'documents',
      roles: ['case_manager', 'administrator', 'adviser'],
      signs: ['Repeated follow-up emails or calls', 'Applications stall waiting for documents', 'Tracking kept in spreadsheets or memory'],
      interviewQuestions: [
        'Roughly how many applications are waiting on documents at any one time?',
        'How do you keep track of which documents are still outstanding?',
        'For a typical application, how many times do you need to chase, and how long does each chase take?',
      ],
      infoToCollect: ['applications per month', 'chases per application', 'minutes per chase', 'systems used to track'],
      metrics: ['Active chasing time per application'],
      likelyClassification: 'automate',
      automationPatterns: ['Scheduled reminders from a document checklist', 'Status tracker visible to the team'],
      humanApproval: ['Staff approve outbound reminder templates', 'No automated changes to case records without review'],
      regulatoryLimits: ['No automated professional judgement on document adequacy'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'case_status_updates',
      title: 'Manual progress updates to clients, introducers and solicitors',
      stageId: 'offer',
      roles: ['case_manager', 'administrator'],
      signs: ['Frequent "any update?" calls', 'Status checked on several lender portals'],
      interviewQuestions: [
        'How do clients and solicitors find out where an application has got to?',
        'Roughly how many status update calls or emails do you handle in a week?',
      ],
      infoToCollect: ['update requests per week', 'minutes per update', 'portals checked'],
      metrics: ['Time spent on status updates per application'],
      likelyClassification: 'automate',
      automationPatterns: ['Milestone-triggered update drafts for staff approval'],
      humanApproval: ['Staff approve each outbound update'],
      regulatoryLimits: [],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'application_rekeying',
      title: 'Re-keying fact-find data into lender systems',
      stageId: 'full_application',
      roles: ['case_manager', 'adviser', 'administrator'],
      signs: ['Same data typed into CRM and lender portal', 'Errors spotted at underwriting'],
      interviewQuestions: [
        'When you submit a full application, how much information do you type in again that already exists elsewhere?',
        'How long does a typical submission take, start to finish?',
      ],
      infoToCollect: ['applications per month', 'minutes per submission', 'systems involved'],
      metrics: ['Submission time per application'],
      likelyClassification: 'overhaul',
      automationPatterns: ['Pre-filled submission checklist from CRM data'],
      humanApproval: ['Adviser or case manager checks every submission'],
      regulatoryLimits: ['Submission content must match the advised recommendation'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    // ---- Added November 2026: common mortgage-firm pain points, so interviews ask sharper, more specific
    // questions and findings line up across firms. Drafts like the cards above: they need review before
    // use with real firms. Cards at regulated stages ask only about the admin around the advice.
    {
      id: 'crm_duplicate_records',
      title: 'Merging duplicate enquiry records',
      stageId: 'enquiry',
      roles: ['administrator', 'adviser'],
      signs: ['The same client appears more than once in the CRM', 'Web or phone enquiries typed in by hand', 'Notes added to the wrong record'],
      interviewQuestions: [
        'How do new enquiries get into your CRM, and does anyone type them in by hand?',
        'How often do you find the same client recorded twice, and what do you do when that happens?',
        'Roughly how long does it take to sort out a duplicate record?',
      ],
      infoToCollect: ['enquiries per month', 'share that become duplicates', 'minutes per merge', 'how enquiries arrive'],
      metrics: ['Duplicate records created per month', 'Time spent merging per month'],
      likelyClassification: 'fix',
      automationPatterns: ['CRM duplicate-matching rule', 'Web form posting straight into the CRM'],
      humanApproval: ['A person confirms every merge'],
      regulatoryLimits: [],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'id_checks',
      title: 'Manual identity and anti-money-laundering checks',
      stageId: 'disclosure_id',
      roles: ['administrator', 'case_manager', 'adviser'],
      signs: ['ID documents collected by email and checked by eye', 'Checks repeated when a client comes back', 'Cases wait for ID before the fact find'],
      interviewQuestions: [
        'How do you collect and check a new client’s identity documents?',
        'How long does that take for a typical client, and how often does something have to be chased?',
        'Where do you record that the checks are done?',
      ],
      infoToCollect: ['new clients per month', 'minutes per check', 'how often ID is chased', 'where the result is recorded'],
      metrics: ['Time per identity check', 'Days from enquiry to checks complete'],
      likelyClassification: 'automate',
      automationPatterns: ['Electronic identity verification with a person reviewing the result', 'Secure upload link instead of email attachments'],
      humanApproval: ['A trained person decides whether checks are satisfactory'],
      regulatoryLimits: ['Anti-money-laundering decisions stay with trained staff; tools only gather and present evidence'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'fact_find_rekeying',
      title: 'Re-keying fact-find notes into the CRM',
      stageId: 'fact_find',
      roles: ['adviser', 'administrator'],
      signs: ['Notes taken on paper or in a separate document', 'Fact finds typed up after the meeting, often in the evening'],
      interviewQuestions: [
        'After a fact-find meeting, how does the information get into your CRM?',
        'How long does typing it up or tidying it take for a typical case?',
        'Is any of the same information asked for again later in the case?',
      ],
      infoToCollect: ['fact finds per month', 'minutes of typing per fact find', 'where notes are first written'],
      metrics: ['Admin time per fact find'],
      likelyClassification: 'automate',
      automationPatterns: ['Fact-find form completed once, straight into the CRM', 'Client fills in factual details before the meeting'],
      humanApproval: ['The adviser checks everything recorded before it is used'],
      regulatoryLimits: ['Only the admin of recording information changes; how the adviser gathers needs and circumstances does not'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'sourcing_rekeying',
      title: 'Copying sourcing and affordability results into the CRM',
      stageId: 'research_affordability',
      roles: ['adviser'],
      signs: ['Client details typed into the sourcing tool and again into the CRM', 'Results saved as screenshots or PDFs by hand'],
      interviewQuestions: [
        'When you research products, how do the client’s details get into the sourcing tool?',
        'How do you record the results afterwards, and how long does that take?',
      ],
      infoToCollect: ['cases researched per month', 'minutes of copying per case', 'systems involved'],
      metrics: ['Admin time per research'],
      likelyClassification: 'fix',
      automationPatterns: ['Use an existing CRM–sourcing integration', 'Attach research output to the case automatically'],
      humanApproval: ['The adviser chooses products; nothing is selected automatically'],
      regulatoryLimits: ['Product research and affordability judgements stay with the adviser'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'lender_portal_logins',
      title: 'Logging back in to lender portals',
      stageId: 'dip',
      roles: ['adviser', 'case_manager'],
      signs: ['Portals time out mid-task', 'Several logins and security codes a day', 'Details re-entered after a timeout'],
      interviewQuestions: [
        'How many lender portals do you use in a typical week?',
        'How often do you have to log back in or start again, and how much time does that cost you in a day?',
      ],
      infoToCollect: ['portals used', 'logins per day', 'minutes lost per day'],
      metrics: ['Time lost to portal logins per person per week'],
      likelyClassification: 'fix',
      automationPatterns: ['Password manager and browser settings', 'Raise timeouts with the lender or network'],
      humanApproval: [],
      regulatoryLimits: ['Credentials are never shared or stored outside approved tools'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'suitability_letter_drafting',
      title: 'Writing suitability letters',
      stageId: 'recommendation',
      roles: ['adviser'],
      signs: ['Letters started from an old letter and edited', 'Factual sections retyped from the fact find', 'Letters written late in the day'],
      interviewQuestions: [
        'Without going into any advice, how do you put a suitability letter together: from a template, an old letter, or from scratch?',
        'How long does a typical letter take, and which parts are factual details copied from elsewhere?',
      ],
      infoToCollect: ['letters per month', 'minutes per letter', 'how much is copied factual detail'],
      metrics: ['Time per suitability letter'],
      likelyClassification: 'keep_human',
      automationPatterns: ['Pre-fill factual sections (client details, product facts) for the adviser to check'],
      humanApproval: ['The adviser writes and approves every recommendation'],
      regulatoryLimits: ['The recommendation and its reasons are the adviser’s; tools may only prepare factual information'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'protection_quotes',
      title: 'Re-entering client details for protection quotes',
      stageId: 'protection',
      roles: ['adviser'],
      signs: ['Client details typed into each insurer’s quote system', 'Quotes compared by hand'],
      interviewQuestions: [
        'Without going into any advice, how do you get protection quotes for a client?',
        'How long does quoting take for a typical case, and how much of the client’s information do you type again?',
      ],
      infoToCollect: ['protection cases per month', 'minutes per quote', 'systems involved'],
      metrics: ['Admin time per protection case'],
      likelyClassification: 'fix',
      automationPatterns: ['Use the quoting tool’s link to the CRM, if one exists'],
      humanApproval: ['The adviser chooses and recommends every policy'],
      regulatoryLimits: ['Protection advice is a separate regulated sale; only the admin around it changes'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'application_handover',
      title: 'Handing a case to the case team',
      stageId: 'full_application',
      roles: ['adviser', 'case_manager'],
      signs: ['No agreed handover note', 'Case managers re-ask clients or advisers for details', 'Each adviser hands over differently'],
      interviewQuestions: [
        'When a case moves from the adviser to the case team, what information goes with it, and how?',
        'How long does the handover take from your side, and how often is something missing?',
        'When something is missing, what happens next and how long does it take to fill the gap?',
      ],
      infoToCollect: ['handovers per month', 'minutes per handover for each side', 'how often information is missing', 'minutes to fill gaps'],
      metrics: ['Time per handover, both sides', 'Share of handovers with missing information'],
      likelyClassification: 'overhaul',
      automationPatterns: ['A standard handover checklist the case cannot move without'],
      humanApproval: ['The adviser confirms the handover note'],
      regulatoryLimits: [],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'document_filing',
      title: 'Filing documents received from clients',
      stageId: 'documents',
      roles: ['administrator', 'case_manager'],
      signs: ['Documents arrive by email and are saved by hand', 'Unclear which case a document belongs to', 'Documents renamed one by one'],
      interviewQuestions: [
        'When a client sends documents, how do they end up on the right case?',
        'Roughly how many documents do you file in a week, and how long does each take?',
      ],
      infoToCollect: ['documents per week', 'minutes per document', 'how often the case is unclear'],
      metrics: ['Filing time per week'],
      likelyClassification: 'fix',
      automationPatterns: ['Secure upload link per case', 'Agreed naming and folder rules'],
      humanApproval: ['A person checks documents are complete and legible'],
      regulatoryLimits: [],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'lender_queries',
      title: 'Lender and underwriter queries passed between the team',
      stageId: 'valuation_underwriting',
      roles: ['case_manager', 'adviser'],
      signs: ['Queries arrive by email or portal message and are forwarded', 'Extra documents requested late', 'Clients contacted more than once for the same thing'],
      interviewQuestions: [
        'When an underwriter raises a query, how does it reach the right person and get answered?',
        'On roughly what share of cases does that happen, and how much extra time does it add?',
      ],
      infoToCollect: ['share of cases with queries', 'minutes per query', 'days added to the case'],
      metrics: ['Time per lender query', 'Days added by queries'],
      likelyClassification: 'fix',
      automationPatterns: ['One owner and one place for lender queries', 'Pre-submission checklist to prevent common queries'],
      humanApproval: ['Answers to lenders are checked by a person'],
      regulatoryLimits: ['Answers must not change the advised recommendation without the adviser'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'solicitor_chasing',
      title: 'Chasing solicitors for progress',
      stageId: 'legal_exchange',
      roles: ['case_manager', 'administrator'],
      signs: ['Weekly chasing calls and emails', 'Progress unknown until someone asks'],
      interviewQuestions: [
        'How do you find out how the legal work is progressing on a case?',
        'How often do you chase solicitors, and how long does each chase take?',
      ],
      infoToCollect: ['cases in legal work at a time', 'chases per case', 'minutes per chase'],
      metrics: ['Chasing time per case in legal work'],
      likelyClassification: 'automate',
      automationPatterns: ['Scheduled chase drafts for staff to send', 'Use the solicitor’s case-tracking portal where available'],
      humanApproval: ['Staff approve each outbound chase'],
      regulatoryLimits: [],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
    {
      id: 'product_expiry_tracking',
      title: 'Tracking product expiries for renewals',
      stageId: 'aftercare_renewal',
      roles: ['adviser', 'administrator'],
      signs: ['Expiry dates kept in a personal list or spreadsheet', 'Clients missed and lost to product transfers', 'Nobody owns renewals'],
      interviewQuestions: [
        'How does the firm know when a client’s mortgage deal is coming to an end?',
        'Who contacts the client, how far ahead, and how often does one get missed?',
      ],
      infoToCollect: ['renewals due per month', 'how far ahead clients are contacted', 'how often one is missed'],
      metrics: ['Share of expiring clients contacted in time'],
      likelyClassification: 'automate',
      automationPatterns: ['Monthly list of upcoming expiries from the CRM', 'Reminder drafts for the adviser to send'],
      humanApproval: ['The adviser decides whether and how to contact each client'],
      regulatoryLimits: ['A reminder is not advice; any new recommendation is a new advised sale'],
      owner: 'UNASSIGNED — needs review',
      lastReviewed: null,
    },
  ],
};

export function cardsForStage(pb: Playbook, stageId: StageId): PlaybookCard[] {
  return pb.cards.filter((c) => c.stageId === stageId);
}
