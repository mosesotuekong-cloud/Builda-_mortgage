// Participant information and consent (brief §4 step 3, §10). Versioned: changing the text
// means a new version, and each participant's consent records the version they agreed to.
// v2 (R3): says exactly what is deleted at the end of retention, what de-identified information is kept,
// and how to withdraw. DRAFT WORDING: needs review against the DPIA before real participants see it.
// People who agreed to v1 keep v1's terms; the deletion treats every discovery as strictly as v1 promised.
export const CONSENT_VERSION = 'consent-2026-11-v2';

export interface ConsentConfig { retentionMonths: number | null; jadaContact: string | null; firmName: string }

export function consentSections(cfg: ConsentConfig): { heading: string; body: string }[] {
  const retention = cfg.retentionMonths
    ? `Your interview is kept for ${cfg.retentionMonths} months after the discovery finishes. Then everything you said is deleted: the conversation, your answers and any quotes, wherever they were used, along with your name and email address. What stays is information that doesn’t identify you or contain your words: the list of problems found, grouped by role, with counts, figures and the firm’s decisions.`
    : 'Retention period: to be confirmed before launch.';
  return [
    { heading: 'What this is for', body: `${cfg.firmName} is reviewing how work moves through the business, so it can find what slows things down and what could be improved or automated. This is about processes, not about assessing you or your performance.` },
    { heading: 'How long it takes', body: 'About 20 to 30 minutes. You can pause at any point and pick up where you left off using the same link.' },
    { heading: 'What you’ll be asked', body: 'An AI interviewer asks about the parts of the mortgage process you work on: the tasks involved, roughly how often they happen and how long they take, the systems you use, and what gets in the way. You only get questions about work you do.' },
    { heading: 'What not to share', body: 'Please do not include client names, contact details, case details or client documents. If something like that is typed, the interview pauses, the details are removed and a person from JADA will get in touch.' },
    { heading: 'Who sees your answers', body: `Your firm lead sees findings grouped by role (for example, “case manager”), not by your name. Your name is never sent to the AI. JADA staff working on this discovery can see the interview to prepare recommendations.` },
    { heading: 'Raising concerns', body: `If you raise a complaint, a compliance concern or a personal employment matter, the interview pauses and a person handles it instead. ${cfg.jadaContact ? `Your JADA contact is ${cfg.jadaContact}.` : 'JADA contact: to be confirmed before launch.'}` },
    { heading: 'Keeping your information', body: retention },
    { heading: 'Changing your mind', body: `You can withdraw at any time, before or after your interview, using the “Withdraw my interview” link on the interview page. Your interview and your words are deleted straight away, everywhere, including any report already made, and the findings are worked out again without you. ${cfg.jadaContact ? `You can also ask ${cfg.jadaContact} to do it for you.` : 'You can also ask JADA to do it for you.'} You don’t have to give a reason.` },
  ];
}

export function assertConsentConfigReady(cfg: ConsentConfig): void {
  if (process.env.NODE_ENV === 'production' && (!cfg.retentionMonths || !cfg.jadaContact)) {
    throw new Error('Retention period and JADA contact must be configured before running in production');
  }
}
