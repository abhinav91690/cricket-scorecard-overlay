/**
 * Re-anonymises whole recordings in two passes: learn every name in every frame, then replace.
 * A name first seen late in a match (a nickname in one dismissal, say) is then hidden in every
 * frame, not only from where it was learned. record.ts runs this on each file when it finishes.
 *
 *   node sim/reanonymise.ts <file.jsonl | file.jsonl.gz> [...]      (rewrites in place)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Anonymiser, loadSalt } from './anonymise.ts';

export function reanonymise(file: string, salt = loadSalt()) {
    const gz = file.endsWith('.gz');
    const text = gz ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
    const rows = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const anon = new Anonymiser(salt);
    for (const r of rows) if (r.data) anon.prime(r.data);
    const out = rows.map(r => JSON.stringify(r.data ? { ...r, data: anon.anonymise(r.data) } : r)).join('\n') + '\n';
    writeFileSync(file, gz ? gzipSync(out, { level: 9 }) : out);
}

if (import.meta.url === `file://${process.argv[1]}`) for (const f of process.argv.slice(2)) { reanonymise(f); console.log(`re-anonymised ${f}`); }
