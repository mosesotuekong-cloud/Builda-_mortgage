import { z } from 'zod';
import type { Db } from '../db/pool';
import type { NotifyEmail } from '../firm/mailer';

// Who hears about a new request, and how. Optional: without it, requests are only in the JADA console.
export interface DemoNotify { mailer: { send(e: NotifyEmail): Promise<void> }; to: string[] }
const ROLE_LABELS: Record<string, string> = { owner_director: 'Owner or director', operations: 'Operations or practice manager', adviser: 'Mortgage adviser', compliance: 'Compliance', other: 'Something else' };

// "Book a demo" requests from the public landing page. JADA staff see them in the JADA console.
export const FIRM_SIZES = ['1-5', '6-20', '21-50', '51-200', '200+'] as const;
export const ROLES = ['owner_director', 'operations', 'adviser', 'compliance', 'other'] as const;

export const DemoRequestSchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name.').max(120),
  email: z.string().trim().max(200).email('Please enter a valid email address.'),
  firmName: z.string().trim().min(2, 'Please tell us your firm’s name.').max(160),
  role: z.enum(ROLES),
  firmSize: z.enum(FIRM_SIZES),
  message: z.string().trim().max(1500).optional().default(''),
});
export type DemoRequestInput = z.infer<typeof DemoRequestSchema>;

export interface DemoRequest extends DemoRequestInput { id: string; createdAt: string }

export class DemoRequestService {
  constructor(private db: Db, private notify: DemoNotify | null = null, private log: (msg: string) => void = console.error) {}

  async create(input: unknown): Promise<{ id: string; name: string }> {
    const r = DemoRequestSchema.parse(input);
    const res = await this.db.query(
      `insert into demo_requests (name, email, firm_name, role, firm_size, message) values ($1,$2,$3,$4,$5,$6) returning id`,
      [r.name, r.email.toLowerCase(), r.firmName, r.role, r.firmSize, r.message || null]);
    // The request is saved first; a failed email never loses it (it's still in the JADA console).
    if (this.notify?.to.length) {
      await this.notify.mailer.send({
        to: this.notify.to, replyTo: r.email.toLowerCase(),
        subject: `Demo request: ${r.firmName} (${r.firmSize} people)`,
        text: [`${r.name} from ${r.firmName} has asked for a BuildA+ demo.`, '',
          `Name: ${r.name}`, `Email: ${r.email.toLowerCase()}`, `Firm: ${r.firmName}`, `Role: ${ROLE_LABELS[r.role] ?? r.role}`, `People in the firm: ${r.firmSize}`,
          `What they'd like to look at: ${r.message || '(nothing added)'}`, '',
          'Reply to this email to answer them directly. All requests are also listed in the JADA console (/jada).'].join('\n'),
      }).catch((err) => this.log(`Demo request ${res.rows[0].id} saved, but the email wasn't sent: ${(err as Error).message}`));
    }
    return { id: res.rows[0].id, name: r.name };
  }

  async list(limit = 200): Promise<DemoRequest[]> {
    const res = await this.db.query(`select * from demo_requests order by created_at desc limit $1`, [limit]);
    return res.rows.map((x) => ({ id: x.id, name: x.name, email: x.email, firmName: x.firm_name, role: x.role, firmSize: x.firm_size,
      message: x.message ?? '', createdAt: x.created_at.toISOString() }));
  }
}
