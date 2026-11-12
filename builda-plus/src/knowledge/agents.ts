// The AI agent catalogue: named agents JADA can build, each tied to the playbook problems it addresses.
// The report and the opportunities pages use these names. A fixed rule matches them (see agentFor), so
// no agent name or description is ever written by the AI.
//
// DRAFT: every entry needs review by JADA (name, what it does, what it never does) before a real firm sees
// it, the same as the playbook cards. Until then each one carries reviewed: false and the report says so.
import type { Classification } from '../domain/journey';

export interface AgentDefinition {
  id: string;
  name: string;                    // "Document Chasing Agent"
  painPointKeys: string[];         // playbook problems it addresses
  summary: string;                 // one line: what it does
  does: string[];                  // what the agent does, step by step
  staysWithPeople: string[];       // what a person always does or approves
  neverDoes: string[];             // hard limits
  regulatedStep: boolean;          // works next to regulated advice: drafts only, and needs a compliance review first
  reviewed: boolean;
}

const ALWAYS = 'Nothing reaches a client, lender or solicitor without a person approving it.';

export const AGENTS: AgentDefinition[] = [
  {
    id: 'document_chasing_agent', name: 'Document Chasing Agent', painPointKeys: ['document_chasing'],
    summary: 'Works out what each client still owes and drafts the reminders, with a checklist of what’s missing.',
    does: ['Reads what each client has already sent and compares it with what the case needs', 'Drafts a reminder listing exactly what is still missing', 'Schedules follow-ups and stops as soon as everything is in', 'Shows the case team one list of who owes what'],
    staysWithPeople: ['Approving each reminder before it is sent (or approving a standard wording once)', 'Deciding what a case needs when it is unusual'],
    neverDoes: [ALWAYS, 'It doesn’t judge whether a document is acceptable to a lender.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'case_update_agent', name: 'Case Update Agent', painPointKeys: ['case_status_updates'],
    summary: 'Drafts progress updates for clients, introducers and solicitors from what has changed on the case.',
    does: ['Notices when a case moves on (valuation booked, offer issued and so on)', 'Drafts a short update for each party that needs one', 'Answers “where are we?” questions with the latest status for a person to send'],
    staysWithPeople: ['Approving each update before it goes', 'Any conversation about bad news or a change to advice'],
    neverDoes: [ALWAYS, 'It doesn’t give advice or promise outcomes or dates the lender hasn’t confirmed.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'solicitor_chasing_agent', name: 'Solicitor Chasing Agent', painPointKeys: ['solicitor_chasing'],
    summary: 'Tracks what each solicitor still needs to do and drafts the chasers.',
    does: ['Keeps a list of what is outstanding with each solicitor', 'Drafts chasers at sensible intervals', 'Flags cases that are stuck for a person to call'],
    staysWithPeople: ['Approving chasers', 'Phone calls and anything that needs judgement'],
    neverDoes: [ALWAYS],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'lender_query_agent', name: 'Lender Query Agent', painPointKeys: ['lender_queries'],
    summary: 'Sorts incoming lender queries and drafts replies from the case file.',
    does: ['Reads each lender query and matches it to the case', 'Gathers the information or document asked for', 'Drafts the reply for the case manager'],
    staysWithPeople: ['Checking and sending every reply', 'Anything that changes the application or the advice'],
    neverDoes: [ALWAYS, 'It doesn’t change application details on its own.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'document_filing_agent', name: 'Document Filing Agent', painPointKeys: ['document_filing'],
    summary: 'Recognises what each incoming document is and files it to the right case.',
    does: ['Recognises the type of document (payslip, bank statement, ID and so on)', 'Files it to the right case and folder', 'Puts anything it isn’t sure about in a queue for a person'],
    staysWithPeople: ['Checking the “not sure” queue', 'Judging whether a document is acceptable'],
    neverDoes: ['It doesn’t delete anything, and it never sends documents outside the firm.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'product_expiry_agent', name: 'Product Expiry Agent', painPointKeys: ['product_expiry_tracking'],
    summary: 'Spots clients whose deals end soon and prepares the review list and first contact for the adviser.',
    does: ['Watches for products ending in the next few months', 'Prepares a list for each adviser with the key details', 'Drafts the first “time to review your mortgage” message'],
    staysWithPeople: ['The review itself and any recommendation (regulated advice)', 'Approving the first message'],
    neverDoes: [ALWAYS, 'It doesn’t recommend products.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'application_entry_agent', name: 'Application Entry Agent', painPointKeys: ['application_rekeying'],
    summary: 'Prepares lender application details from what is already in your CRM, so nobody types them twice.',
    does: ['Pulls the client and case details already held', 'Prepares them in the form the lender needs', 'Highlights anything missing or inconsistent'],
    staysWithPeople: ['Checking and submitting every application'],
    neverDoes: ['It doesn’t submit applications.'],
    regulatedStep: false, reviewed: false,
  },
  {
    id: 'fact_find_notes_agent', name: 'Fact-find Notes Agent', painPointKeys: ['fact_find_rekeying'],
    summary: 'Drafts structured fact-find notes from the adviser’s own notes, for the adviser to check.',
    does: ['Turns the adviser’s meeting notes into the fact-find fields', 'Highlights anything missing'],
    staysWithPeople: ['The fact find itself and every judgement in it', 'Checking and correcting every field'],
    neverDoes: ['It doesn’t give advice or decide anything about the client’s needs.'],
    regulatedStep: true, reviewed: false,
  },
];

// The agent for an opportunity: only problems the firm chose to automate (never keep-human, fixes or
// overhauls), matched by the playbook problem they came from.
export function agentFor(key: string, classification: Classification | null): AgentDefinition | null {
  if (classification !== 'automate') return null;
  return AGENTS.find((a) => a.painPointKeys.includes(key)) ?? null;
}
