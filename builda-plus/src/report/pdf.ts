import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import type { ReportModel } from './model';

const C = { ink: '#1C2B3A', muted: '#56657A', green: '#2E6B58', line: '#C9D1D9', warn: '#7A4E0E', soft: '#EEF1F3' };

export function renderReportPdf(model: ReportModel, opts: { fontDir?: string; compress?: boolean } = {}): Promise<Buffer> {
  const fontDir = opts.fontDir ?? join(process.cwd(), 'public', 'fonts');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 72, left: 64, right: 64 }, bufferPages: true, compress: opts.compress ?? true,
    info: { Title: `Discovery report — ${model.firmName}`, Author: 'BuildA+ by JADA', Subject: 'Operational discovery report' } });
  doc.registerFont('serif', join(fontDir, 'SourceSerif4-Regular.ttf'));
  doc.registerFont('serif-bold', join(fontDir, 'SourceSerif4-Semibold.ttf'));
  doc.registerFont('sans', join(fontDir, 'AtkinsonHyperlegible-Regular.ttf'));
  doc.registerFont('sans-bold', join(fontDir, 'AtkinsonHyperlegible-Bold.ttf'));

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 128;

  const ensure = (h: number) => { if (doc.y + h > doc.page.height - 80) doc.addPage(); };
  const h1 = (t: string) => { ensure(80); doc.moveDown(1.2).font('serif-bold').fontSize(18).fillColor(C.ink).text(t); doc.moveDown(0.4); };
  const h2 = (t: string) => { ensure(72); doc.moveDown(0.7).font('sans-bold').fontSize(11).fillColor(C.ink).text(t); doc.moveDown(0.2); };
  const h3 = (t: string) => { ensure(48); doc.moveDown(0.3).font('sans-bold').fontSize(9.5).fillColor(C.muted).text(t); doc.moveDown(0.15); };
  const para = (t: string, color = C.ink) => doc.font('sans').fontSize(10).fillColor(color).text(t, { lineGap: 2.5 });
  const bullets = (items: string[], color = C.ink) => { for (const i of items) { ensure(20); doc.font('sans').fontSize(10).fillColor(color).text(`•  ${i}`, { indent: 0, lineGap: 2.5 }); doc.moveDown(0.15); } };
  const rows = (pairs: { label: string; value: string }[]) => {
    for (const r of pairs) {
      ensure(18);
      const y = doc.y;
      doc.font('sans').fontSize(9.5).fillColor(C.muted).text(r.label, 64, y, { width: 190 });
      const h1y = doc.y;
      doc.font('sans').fontSize(9.5).fillColor(C.ink).text(r.value, 264, y, { width: W - 200 });
      doc.y = Math.max(h1y, doc.y) + 3; doc.x = 64;
    }
  };
  const numbered = (items: string[]) => { items.forEach((t, i) => { ensure(20); doc.font('sans').fontSize(10).fillColor(C.ink).text(`${i + 1}.  ${t.replace(/^\d+[.)]\s*/, '')}`, { lineGap: 2.5 }); doc.moveDown(0.15); }); };
  const lead = (t: string) => { ensure(30); doc.font('sans-bold').fontSize(10.5).fillColor(C.ink).text(t, { lineGap: 2.5 }); doc.moveDown(0.3); };
  const quote = (q: { role: string; quote: string }) => {
    ensure(24);
    const y = doc.y;
    doc.font('serif').fontSize(10.5).fillColor(C.ink).text(`“${q.quote}”`, 76, y, { width: W - 12 });
    doc.font('sans').fontSize(8.5).fillColor(C.muted).text(q.role, 76);
    doc.moveTo(66, y).lineTo(66, doc.y).lineWidth(1.5).strokeColor(C.line).stroke();
    doc.x = 64; doc.moveDown(0.35);
  };

  // ---- cover ----
  doc.font('sans').fontSize(10).fillColor(C.green).text('BuildA+ discovery report');
  doc.moveDown(2.5);
  doc.font('serif-bold').fontSize(30).fillColor(C.ink).text(model.firmName, { lineGap: 2 });
  doc.font('serif').fontSize(16).fillColor(C.muted).text('How work moves through the business, and where to improve it first');
  doc.moveDown(1.5);
  doc.font('sans').fontSize(9.5).fillColor(C.muted).text(`Version ${model.version}, generated ${new Date(model.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  doc.moveDown(2.5);
  if (model.knowledge && !model.knowledge.reviewed) {
    doc.font('sans-bold').fontSize(10).fillColor(C.warn).text('Draft: produced with an unreviewed development playbook. Not for use with a real firm.');
    doc.moveDown(0.5);
  }
  h2('In brief');
  bullets(model.summary);
  h2('How to read this report');
  bullets(model.disclaimers, C.muted);

  // ---- AI agents first ----
  const agents = model.agents ?? [];
  const planBlock = (plan: NonNullable<ReportModel['businessCases'][number]['plan']>, full: boolean) => {
    if (full) {
      h2('How it will work'); numbered(plan.howItWorks);
      h2('The difference');
      rows([{ label: 'Today', value: plan.before.join(' ') }, { label: 'After the change', value: plan.after.join(' ') }]);
      if (plan.build) {
        // The technical approach in plain words, for the owner and their IT contact.
        const k = plan.build;
        h2('How we’ll build it');
        rows([{ label: 'Approach', value: k.approach }, { label: 'Use of AI', value: k.aiRole }]);
        h3('What we build or set up'); bullets(k.components);
        h3('How it connects to your systems'); bullets(k.connections);
        h3('How we test it before it goes live'); bullets(k.testing);
      }
    }
    h2(`Timeline: ${plan.timeline.headline}`);
    if (full) { rows(plan.timeline.steps.map((x) => ({ label: x.when, value: x.what }))); para(plan.timeline.afterwards, C.muted); }
    h2('How we’ll know it worked'); bullets(full ? plan.measures : plan.measures.slice(0, 2));
    if (full) { h2('What we need from you'); bullets(plan.needFromYou); }
  };
  if (agents.length) {
    doc.addPage();
    h1('AI agents we recommend');
    para('Each agent takes on a routine part of the work your team described, and a person approves what it does. They are listed in priority order, and each keeps its own evidence rating, so a weaker case reads as weaker.', C.muted);
    if (agents.some((a) => !a.reviewed)) { doc.moveDown(0.3); para('Draft: these agent descriptions have not yet been reviewed by JADA.', C.warn); }
    agents.forEach((a, i) => {
      if (i > 0) doc.addPage(); else doc.moveDown(0.8);
      doc.font('serif-bold').fontSize(20).fillColor(C.green).text(a.name);
      doc.font('sans').fontSize(9.5).fillColor(C.muted).text(`For: ${a.problem} · ${a.stage}${a.priorityRank ? ` · Priority ${a.priorityRank}` : ''} · Evidence: ${a.confidence}`);
      if (a.requiresComplianceReview) doc.font('sans-bold').fontSize(9).fillColor(C.warn).text('Works next to regulated advice: drafts only, and needs a compliance review before it is built');
      doc.moveDown(0.4); lead(a.summary);
      h2('What it does'); bullets(a.does);
      h2('What stays with your team'); bullets(a.staysWithPeople);
      h2('What it never does'); bullets(a.neverDoes);
      h2('Why: what this costs you today'); rows(a.figures);
      if (a.unknowns.length) para(`Still unknown: ${a.unknowns.join(', ').toLowerCase()}.`, C.muted);
      if (a.evidence.length) { h2('What people said'); a.evidence.forEach(quote); }
      if (a.plan) planBlock(a.plan, true);
    });
  }

  // ---- other improvements: process automation, fixes and redesigns, shorter ----
  doc.addPage();
  h1(model.agents ? 'Other improvements' : 'Top opportunities');
  if (model.agents) para('Process automation, fixes and redesigns among your top priorities, in brief. The full detail is on each opportunity’s page in BuildA+.', C.muted);
  if (!model.businessCases.length) para(model.agents ? 'None beyond the agents above.' : 'No opportunities have enough evidence to rank yet.', C.muted);
  model.businessCases.forEach((b, i) => {
    if (!model.agents && i > 0) doc.addPage(); else doc.moveDown(0.6);
    ensure(160);
    doc.font('serif-bold').fontSize(14).fillColor(C.ink).text(`${b.rank}. ${b.title}`);
    doc.font('sans').fontSize(9.5).fillColor(C.muted).text(`${b.stage} · ${b.approach} · Evidence: ${b.confidence}`);
    if (b.requiresComplianceReview) doc.font('sans-bold').fontSize(9).fillColor(C.warn).text('Requires compliance review before any change');
    h2('What happens today'); bullets(b.currentProcess);
    if (!model.agents && b.evidence.length) { h2('What people said'); b.evidence.forEach(quote); }
    h2('The numbers'); rows(b.figures);
    if (b.unknowns.length) para(`Still unknown: ${b.unknowns.join(', ').toLowerCase()}.`, C.muted);
    if (b.plan) {
      h2('What we’ll do'); lead(b.plan.headline); bullets(b.plan.whatWeBuild);
      if (b.plan.staysWithPeople.length) { h2('What stays with your team'); bullets(b.plan.staysWithPeople); }
      planBlock(b.plan, !model.agents);
    } else { h2('Proposed improvement'); bullets(b.improvement); }
    rows([{ label: 'Implementation complexity', value: b.complexity }, { label: 'Payback', value: b.payback }]);
    if (b.assumptions.length) { h2('Assumptions'); bullets(b.assumptions, C.muted); }
  });

  if (model.offer) {
    // The proposition: what JADA builds, by when, and how the firm sees the difference.
    h1(model.offer.headline);
    lead(model.offer.lead);
    for (const it of model.offer.items) {
      ensure(48);
      doc.font('sans-bold').fontSize(10).fillColor(C.ink).text(it.title, { lineGap: 2 });
      rows([{ label: 'What you get', value: it.deliver }, { label: 'When', value: it.when }, { label: 'How we’ll know it worked', value: it.measure }]);
      doc.moveDown(0.3);
    }
    h2('How we work'); bullets(model.offer.conditions);
  } else {
    h1('Recommended two-week build');
    para(model.recommendedBuild.text);
    if (model.recommendedBuild.blockers.length) { h2('What needs to happen first'); bullets(model.recommendedBuild.blockers); }
    if (model.recommendedBuild.toConfirm.length) { h2('To confirm in JADA engineering review'); bullets(model.recommendedBuild.toConfirm, C.muted); }
  }
  if (model.toProceed.length) { h1('What we need from you'); bullets(model.toProceed); }

  // ---- appendices: the background behind the recommendations ----
  doc.addPage();
  let letter = 0;
  const appendix = (title: string) => h1(`Appendix ${String.fromCharCode(65 + letter++)}: ${title}`);
  appendix('Your firm');
  if (model.profile.length) rows(model.profile); else para('The firm profile has not been completed.', C.muted);
  h2('Who took part');
  rows(model.participation.map((x) => ({ label: x.role, value: `${x.completed} of ${x.total} completed` })));

  appendix('Your mortgage journey');
  para('Where reported pain points sit. Stages marked “adviser judgement” involve regulated decisions: automation there may only prepare information.', C.muted);
  doc.moveDown(0.4);
  model.journey.forEach((st, i) => {
    ensure(20);
    const y = doc.y;
    doc.font('sans').fontSize(9).fillColor(C.muted).text(String(i + 1), 64, y, { width: 20 });
    doc.font('sans-bold').fontSize(9.5).fillColor(C.ink).text(st.stage, 88, y, { width: 170 });
    let ly = doc.y;
    if (st.regulated) { doc.font('sans').fontSize(8).fillColor(C.warn).text('Adviser judgement', 88, doc.y, { width: 170 }); ly = doc.y; }
    doc.font('sans').fontSize(9.5).fillColor(st.painPoints.length ? C.ink : C.muted).text(st.painPoints.join('; ') || '—', 268, y, { width: W - 204 });
    doc.y = Math.max(ly, doc.y) + 4; doc.x = 64;
    doc.moveTo(64, doc.y - 2).lineTo(64 + W, doc.y - 2).lineWidth(0.5).strokeColor(C.line).stroke();
  });

  if (model.otherFindings.length) {
    appendix('Other findings');
    rows(model.otherFindings.map((o) => ({ label: o.title, value: `${o.stage}. ${o.approach}. Evidence: ${o.confidence}.${o.note ? ` ${o.note}.` : ''}` })));
  }

  appendix('Across roles');
  h2('Where people agreed'); bullets(model.crossRole.agreements.length ? model.crossRole.agreements : ['No item was yet described consistently by several people.']);
  h2('Where accounts differed');
  if (model.crossRole.differences.length) model.crossRole.differences.forEach((d) => bullets([`${d.title}. ${d.detail}.`]));
  else bullets(['No material differences.']);
  para('Differences are not errors. They often show that the same task varies between cases or roles, and are worth a conversation.', C.muted);
  h2('Raised by staff but not by management');
  bullets(model.crossRole.blindSpots === null ? ['Not available: the firm lead has not completed an interview.'] : model.crossRole.blindSpots.length ? model.crossRole.blindSpots : ['None.']);
  if (model.crossRole.unreportedStages.length) { h2('Stages nobody described'); para(model.crossRole.unreportedStages.join(', ') + '.'); }

  appendix('Points for compliance review');
  for (const r of model.regulatoryItems ?? []) {
    ensure(60);
    doc.font('sans-bold').fontSize(10).fillColor(C.ink).text(`${r.title} — ${r.stage}`);
    if (r.notCovered) para('Not covered by the approved knowledge base. Refer this to a qualified compliance reviewer before making any change.', C.warn);
    for (const c of r.checks) {
      ensure(40);
      doc.font('sans').fontSize(10).fillColor(C.ink).text(`${c.title}: ${c.requiredAction}`, { lineGap: 2.5 });
      for (const cite of c.citations) doc.font('sans').fontSize(8.5).fillColor(C.muted).text(`Source: ${cite}`, { lineGap: 1.5 });
    }
    doc.moveDown(0.5);
  }
  bullets(model.regulatoryReview);
  if (model.outstandingQuestions.length) { appendix('Open questions'); bullets(model.outstandingQuestions); }
  if (model.sourcesCited?.length) { appendix('Sources'); bullets(model.sourcesCited, C.muted); }

  // ---- footer on every page ----
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('sans').fontSize(8).fillColor(C.muted)
      .text(`${model.firmName} — discovery report v${model.version} — confidential`, 64, doc.page.height - 44, { width: W / 2 + 60, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, 64, doc.page.height - 44, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
