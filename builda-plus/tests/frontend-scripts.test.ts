import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The workspace page loads several plain scripts that share one global scope. A function declared with the
// same name in two of them silently replaces the earlier one (this broke the Discovery overview once).
const publicDir = join(__dirname, '..', 'public');
const topLevelNames = (file: string) => [...readFileSync(join(publicDir, file), 'utf8').matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1] ?? m[2]!);

describe('scripts that share a page', () => {
  for (const page of ['app.html', 'engineering.html']) {
    it(`${page}: no two scripts declare the same top-level name`, () => {
      const scripts = [...readFileSync(join(publicDir, page), 'utf8').matchAll(/<script src="\/static\/([\w-]+\.js)"/g)].map((m) => m[1]!);
      expect(scripts.length).toBeGreaterThan(0);
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const s of scripts) for (const name of new Set(topLevelNames(s))) {
        if (seen.has(name)) clashes.push(`${name}: ${seen.get(name)} and ${s}`); else seen.set(name, s);
      }
      expect(clashes).toEqual([]);
    });
  }
});
