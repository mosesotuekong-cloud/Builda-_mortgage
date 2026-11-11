export interface OutgoingEmail { to: string; subject: string; text: string }
export interface Mailer { send(email: OutgoingEmail): Promise<void> }

// Development mailer: keeps messages in memory and logs the link. Replace with a real provider.
export class DevOutboxMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  constructor(private log = false) {}
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    if (this.log) console.log(`[mail] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
  }
}

// Brevo (brevo.com) transactional email: one HTTPS call, no extra package. The sender must be a sender or
// domain verified in Brevo (Senders, Domains & Dedicated IPs). "from" is "Name <address>" or just an address.
export interface NotifyEmail { to: string[]; subject: string; text: string; replyTo?: string }
export const parseSender = (from: string): { name?: string; email: string } => {
  const m = /^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(from);
  return m ? { ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}), email: m[2]! } : { email: from.trim() };
};
export class BrevoMailer {
  private sender: { name?: string; email: string };
  constructor(private apiKey: string, from: string) { this.sender = parseSender(from); }
  async send(email: NotifyEmail): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: this.sender, to: email.to.map((address) => ({ email: address })), subject: email.subject, textContent: email.text,
        ...(email.replyTo ? { replyTo: { email: email.replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Brevo refused the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}
