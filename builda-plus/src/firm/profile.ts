import { z } from 'zod';
import { ROLES } from '../domain/journey';

// Technology inventory (Phase 2). Information gathering only: an entry never implies an integration.
export const TECHNOLOGY_CATEGORIES = ['crm_mortgage', 'email_communication', 'document_management', 'productivity', 'accounting_finance', 'other'] as const;
export const TECHNOLOGY_TEAMS = ['advisers', 'case_managers', 'administrators', 'management', 'other'] as const;
export const TechnologySchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(TECHNOLOGY_CATEGORIES),
  purpose: z.string().trim().max(300).default(''),
  teams: z.array(z.enum(TECHNOLOGY_TEAMS)).max(TECHNOLOGY_TEAMS.length).default([]),
  notes: z.string().trim().max(500).default(''),
});
export type TechnologyEntry = z.infer<typeof TechnologySchema>;

export const BUSINESS_FOCUS = ['residential_purchase', 'remortgage_product_transfer', 'buy_to_let', 'later_life', 'protection', 'commercial_specialist'] as const;
export const OPERATING_MODELS = ['advisers_with_case_managers', 'advisers_own_cases', 'central_processing', 'mixed'] as const;

// Firm profile questionnaire (brief §4 step 2). Completed by the firm lead before interviews.
// Stored as JSON on the discovery; the Phase 2 fields are optional so earlier profiles stay valid.
export const FirmProfileSchema = z.object({
  advisers: z.number().int().min(0).max(500),
  monthlyApplications: z.number().int().min(0).nullable(),
  typicalWeeksEnquiryToOffer: z.number().min(0).max(104).nullable(),
  businessStructure: z.string().max(1000),
  staffRoles: z.array(z.object({ role: z.enum(ROLES), count: z.number().int().min(0) })),
  systems: z.array(z.string().max(100)).max(50),
  authorisation: z.enum(['directly_authorised', 'network_appointed_representative', 'unsure']),
  operationalChallenges: z.string().max(4000),
  // Optional: used only to put a value on recovered capacity. Never estimated by the platform.
  loadedHourlyCostGBP: z.number().positive().max(1000).nullable(),
  // Phase 2 — all optional.
  website: z.union([z.string().trim().url().max(300), z.literal('')]).optional(),
  location: z.string().trim().max(200).optional(),
  businessFocus: z.array(z.enum(BUSINESS_FOCUS)).max(BUSINESS_FOCUS.length).optional(),
  operatingModel: z.enum(OPERATING_MODELS).nullable().optional(),
  technology: z.array(TechnologySchema).max(50).optional(),
  // Roles beyond advisers, case managers and administrators (paraplanners, protection specialists...).
  otherRoles: z.array(z.object({ name: z.string().trim().min(1).max(60), count: z.number().int().min(0).max(500) })).max(10).optional(),
  // Anything else about the firm that doesn't fit a field. Kept on the profile and in the report; not sent to the interviewer.
  notes: z.string().max(2000).optional(),
}).transform((p) => (p.technology
  // Once an inventory exists it is the source of the systems list used by reports and implementation packs.
  ? { ...p, systems: [...new Set(p.technology.map((t) => t.name))].slice(0, 50) }
  : p));
export type FirmProfile = z.infer<typeof FirmProfileSchema>;
