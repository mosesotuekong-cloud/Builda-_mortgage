import type { PlaybookCard } from '../knowledge/playbook';

// A domain pack: everything industry-specific the core needs (design decision D4). Packs are data and
// versioned; a node that matched a pack type records the version it matched.
export interface PackStage { id: string; name: string; regulated: boolean }
export interface PackRole { id: string; label: string; stages: string[] }
export interface PackType { id: string; label: string; stage?: string; roles?: string[]; synonyms: string[] }
export interface DomainPack {
  id: string;
  version: string;
  name: string;
  stages: PackStage[];
  roles: PackRole[];
  activityTypes: PackType[];
  informationTypes: PackType[];
  parties: { id: string; label: string }[];
  problemPatterns: PlaybookCard[];   // diagnostic knowledge; never creates a problem or a question on its own
  // The domain's advice boundary, added to the shared safety rules (e.g. "never give mortgage advice").
  adviceBoundary: string;
}

export const stageName = (pack: DomainPack, id: string | null) => pack.stages.find((s) => s.id === id)?.name ?? id ?? 'unplaced';
export const roleLabel = (pack: DomainPack, id: string | null) => pack.roles.find((r) => r.id === id)?.label ?? id ?? 'someone';
export const isStage = (pack: DomainPack, id: unknown): id is string => typeof id === 'string' && pack.stages.some((s) => s.id === id);
export const isRole = (pack: DomainPack, id: unknown): id is string => typeof id === 'string' && pack.roles.some((r) => r.id === id);
export const isParty = (pack: DomainPack, id: unknown): id is string => typeof id === 'string' && pack.parties.some((r) => r.id === id);
export function typeById(pack: DomainPack, id: string | null): PackType | null {
  if (!id) return null;
  return pack.activityTypes.find((t) => t.id === id) ?? pack.informationTypes.find((t) => t.id === id) ?? null;
}
