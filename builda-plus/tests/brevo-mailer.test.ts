import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrevoMailer, parseSender } from '../src/firm/mailer';

// "Book a demo" emails go through Brevo's transactional API. The network is stubbed: no email is sent.
describe('Brevo mailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads "Name <address>" or a bare address as the sender', () => {
    expect(parseSender('BuildA+ <demo@jadasquad.com>')).toEqual({ name: 'BuildA+', email: 'demo@jadasquad.com' });
    expect(parseSender('demo@jadasquad.com')).toEqual({ email: 'demo@jadasquad.com' });
  });

  it('sends one request to Brevo with the key, recipients, text and Reply-To', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"messageId":"x"}', { status: 201 }); });
    await new BrevoMailer('test-key', 'BuildA+ <demo@jadasquad.com>').send({
      to: ['moses.otuekong@jadasquad.com', 'azeez@jadasquad.com'], subject: 'Demo request: Example (6-20 people)', text: 'Hello', replyTo: 'alex@example.test',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((calls[0]!.init.headers as Record<string, string>)['api-key']).toBe('test-key');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      sender: { name: 'BuildA+', email: 'demo@jadasquad.com' },
      to: [{ email: 'moses.otuekong@jadasquad.com' }, { email: 'azeez@jadasquad.com' }],
      subject: 'Demo request: Example (6-20 people)', textContent: 'Hello', replyTo: { email: 'alex@example.test' },
    });
  });

  it('reports what Brevo said when it refuses (for example, an unverified sender)', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"code":"unauthorized","message":"Sender not valid"}', { status: 400 }));
    await expect(new BrevoMailer('k', 'demo@jadasquad.com').send({ to: ['a@b.test'], subject: 's', text: 't' }))
      .rejects.toThrow(/Brevo refused the email \(400\).*Sender not valid/);
  });
});
