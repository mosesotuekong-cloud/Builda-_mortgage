import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertConsentConfigReady, consentSections } from '../src/participant/consent';
import { SOLUTION_TEMPLATES, readiness, OUTLOOK_SPIKE_GATE } from '../src/knowledge/solutionTemplates';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';

// Phase 6: guards that must hold before any pilot. These never pass by default; they fail closed.
const withEnv = (v: string, fn: () => void) => { const prev = process.env.NODE_ENV; process.env.NODE_ENV = v; try { fn(); } finally { process.env.NODE_ENV = prev; } };

describe('pilot readiness guards', () => {
  it('production refuses to start without a retention period and a JADA contact', () => {
    withEnv('production', () => {
      expect(() => assertConsentConfigReady({ retentionMonths: null, jadaContact: 'x', firmName: '' })).toThrow(/Retention/);
      expect(() => assertConsentConfigReady({ retentionMonths: 12, jadaContact: null, firmName: '' })).toThrow(/JADA contact/);
    });
  });

  it('the consent text says retention is to be confirmed rather than promising a deletion that is not configured', () => {
    const text = consentSections({ retentionMonths: null, jadaContact: null, firmName: 'Test' }).map((s) => s.body).join(' ');
    expect(text).toMatch(/to be confirmed before launch/);
    expect(text).not.toMatch(/then deleted/);
  });

  it('the consent text (v2) says what is deleted, what is kept, and how to withdraw', () => {
    const s = consentSections({ retentionMonths: 12, jadaContact: 'Jo at JADA', firmName: 'Test' });
    const keep = s.find((x) => x.heading === 'Keeping your information')!.body;
    expect(keep).toMatch(/12 months/);
    expect(keep).toMatch(/your name and email address/);
    expect(keep).toMatch(/doesn’t identify you or contain your words/);
    expect(s.find((x) => x.heading === 'Changing your mind')!.body).toMatch(/Withdraw my interview.*Jo at JADA.*don’t have to give a reason/s);
  });

  it('no template is production-ready, and the Outlook template stays gated on the spike', () => {
    const matrix = SOLUTION_TEMPLATES.map((t) => ({ id: t.id, reviewed: t.approval.status === 'reviewed', tested: t.validation === 'tested', ready: readiness(t).productionReady }));
    expect(matrix).toEqual([
      { id: 'document_chasing_v1', reviewed: false, tested: false, ready: false },
      { id: 'outlook_follow_up_drafts_r2_1', reviewed: true, tested: false, ready: false },
    ]);
    expect(OUTLOOK_SPIKE_GATE.status).toBe('not_run');
  });

  it('the Outlook template never asks for send permission or unscoped mail access', () => {
    const t = SOLUTION_TEMPLATES.find((x) => x.id === 'outlook_follow_up_drafts_r2_1')!;
    const perms = t.requiredPermissions.join(' ');
    expect(perms).toMatch(/No Mail\.Send permission/);
    expect(perms).toMatch(/RBAC for Applications/);
    expect(t.architectureOverview.join(' ')).toMatch(/No continuous mailbox scanning/);
    expect(t.humanControls.join(' ')).toMatch(/a person reviews and sends/);
  });

  it('the seed playbook is marked unreviewed, so it can never pass as approved knowledge', () => {
    expect(SEED_PLAYBOOK.reviewed).not.toBe(true);
  });

  it('BuildA+ source requests no Mail.Send scope anywhere', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
    walk(join(__dirname, '..', 'src'));
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"`]Mail\.Send['"`]|scope=.*Mail\./);
  });
});
