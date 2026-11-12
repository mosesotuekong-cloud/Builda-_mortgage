import { FirmProfileSchema, type FirmProfile } from '../firm/profile';

// What the interviewer knows about the firm, from the profile the firm lead filled in. It helps the AI ask
// relevant, specific questions (the firm's own system names, skipping work the firm doesn't do).
// Left out on purpose: the firm's name, website and location (not needed to ask good questions) and the
// hourly cost (only for valuing time). The lead's own view of the problems is included for relevance, but the
// prompt forbids revealing it or suggesting problems the participant hasn't raised.
const FOCUS: Record<string, string> = {
  residential_purchase: 'residential purchase', remortgage_product_transfer: 'remortgages and product transfers', buy_to_let: 'buy-to-let',
  later_life: 'later life lending', protection: 'protection', commercial_specialist: 'commercial and specialist',
};
const MODEL: Record<string, string> = {
  advisers_with_case_managers: 'advisers supported by dedicated case managers', advisers_own_cases: 'advisers manage their own cases',
  central_processing: 'a central processing or administration team', mixed: 'a mix of set-ups',
};
const CATEGORY: Record<string, string> = {
  crm_mortgage: 'CRM / mortgage platform', email_communication: 'email and communication', document_management: 'document management',
  productivity: 'productivity', accounting_finance: 'accounting and finance', other: 'other',
};
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function parseProfile(raw: unknown): FirmProfile | null {
  if (!raw || (typeof raw === 'object' && Object.keys(raw as object).length === 0)) return null;
  const p = FirmProfileSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export function firmContextBrief(p: FirmProfile | null): string | null {
  if (!p) return null;
  const count = (role: string) => p.staffRoles.find((r) => r.role === role)?.count;
  const people = [`${p.advisers} mortgage adviser${p.advisers === 1 ? '' : 's'}`,
    count('case_manager') ? `${count('case_manager')} case manager${count('case_manager') === 1 ? '' : 's'}` : null,
    count('administrator') ? `${count('administrator')} administrator${count('administrator') === 1 ? '' : 's'}` : null,
    ...(p.otherRoles ?? []).filter((r) => r.count > 0).slice(0, 6).map((r) => `${r.count} ${clip(r.name, 40).toLowerCase()}`)].filter(Boolean).join(', ');
  const lines = [
    `- People: ${people}.`,
    p.monthlyApplications ? `- About ${p.monthlyApplications} mortgage applications a month.` : null,
    p.typicalWeeksEnquiryToOffer ? `- A typical case takes about ${p.typicalWeeksEnquiryToOffer} weeks from enquiry to offer.` : null,
    p.businessFocus?.length ? `- Main business: ${p.businessFocus.map((f) => FOCUS[f] ?? f).join(', ')}. Other kinds of mortgage work are not a focus.` : null,
    p.operatingModel ? `- Set-up: ${MODEL[p.operatingModel] ?? p.operatingModel}.` : null,
    p.authorisation === 'network_appointed_representative' ? '- An appointed representative of a network (the network’s own rules may shape some processes).' : null,
    p.businessStructure?.trim() ? `- How the firm is organised: ${clip(p.businessStructure, 400)}` : null,
  ];
  const tech = (p.technology ?? []).slice(0, 12).map((t) => `  - ${t.name} (${CATEGORY[t.category] ?? t.category})${t.purpose ? `: ${clip(t.purpose, 120)}` : ''}`);
  const systems = tech.length ? ['- Systems the firm uses:', ...tech] : p.systems.length ? [`- Systems the firm uses: ${p.systems.slice(0, 12).join(', ')}.`] : [];
  const view = p.operationalChallenges?.trim() ? [`- Where the firm lead thinks work gets stuck (PRIVATE: never mention, quote or hint at this): ${clip(p.operationalChallenges, 600)}`] : [];
  const body = [...lines.filter(Boolean), ...systems, ...view];
  return body.length ? body.join('\n') : null;
}
