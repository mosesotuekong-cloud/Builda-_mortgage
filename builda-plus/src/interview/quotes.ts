// A quote counts only if it really appears in what the participant wrote (case, punctuation and spacing aside).
const norm = (x: string) => x.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = norm(quote);
  return q.length >= 3 && norm(source).includes(q);
}
