/**
 * Anonymises a CricClubs payload so a real match can be kept and replayed without naming anyone.
 *
 * - Player names are replaced WORD BY WORD with made-up words, the same real word always giving
 *   the same fake one. So "Anand S", "Anand Babu Badrichetty" and a row's firstName/lastName stay
 *   consistent, and the overlay's matching (award to card row, batter to partnership) still works.
 *   Each fake word keeps the real word's first letter and case, so initials ("Anand S") need no
 *   rewriting.
 * - Email addresses become player-<hash>@example.invalid, keeping the field's shape.
 * - Player IDs become other numbers, consistently, keeping number or string type.
 * - Team, ground and series names are public club names and are kept.
 *
 * The mapping is salted with a secret kept outside the repo, so a list of real names cannot be
 * hashed to reverse it. ⚠ Profile-picture paths are kept: they point at CricClubs' public photos.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const SALT_FILE = `${homedir()}/.config/cricket-scorecard-overlay/anon_salt`;

export function loadSalt(file = SALT_FILE): string {
    if (!existsSync(file)) {
        mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
        writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    return readFileSync(file, 'utf8').trim();
}

/** Keys whose value is a person: players, and the award. */
const PERSON_KEY = /^(batsman[12](Display|First|Last|Nick)?Name|bowler(First|Last|Nick)?Name|lastOut(First|Last)?Name|partnershipBatsman[12](First|Last)?Name|firstName|lastName|shortName|nickName|careerPlayerName|manOfTheMatch|manOfTheMatchNickName|playerName|fielderName|umpire\w*Name)$/;
/** Keys whose value is a player's ID. Team, match and club IDs are left alone. */
const PERSON_ID = /^(batsman[12]ID|bowlerID|lastOutID|partnershipBatsman[12]ID|playerID|playerId)$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** Words that appear next to names in dismissals and must survive: "c Sub b", "Retired Out". */
const KEEP = new Set(['sub', 'substitute', 'retired', 'out', 'not', 'run', 'lbw', 'st', 'hit', 'wicket', 'obstructing', 'the', 'field', 'handled', 'ball', 'timed', 'absent', 'hurt', 'and']);

const CONS = 'bdfghjklmnprstvz', VOW = 'aeiou';

export class Anonymiser {
    private words = new Map<string, string>();
    /** Every person word seen so far, across frames: a fielder named once stays hidden afterwards. */
    private seen = new Set<string>();
    private salt: string;
    constructor(salt: string) { this.salt = salt; }

    private h(s: string) { return createHmac('sha256', this.salt).update(s).digest(); }

    /** A made-up word with the real word's first letter, case and roughly its length. */
    fakeWord(word: string): string {
        const key = word.toLowerCase();
        let fake = this.words.get(key);
        if (!fake) {
            const b = this.h(`w:${key}`);
            const len = Math.min(10, Math.max(3, key.length));
            let out = key[0];
            for (let i = 1; out.length < len; i++) out += (out.length % 2 ? VOW : CONS)[b[i % b.length] % (out.length % 2 ? VOW.length : CONS.length)];
            fake = out;
            this.words.set(key, fake);
        }
        if (word === word.toUpperCase()) return fake.toUpperCase();
        if (word[0] === word[0].toUpperCase()) return fake[0].toUpperCase() + fake.slice(1);
        return fake;
    }

    fakeId(id: number | string): number | string {
        const n = this.h(`id:${id}`).readUInt32BE(0) % 9_000_000 + 1_000_000;
        return typeof id === 'number' ? n : String(n);
    }

    fakeEmail(email: string): string { return `player-${this.h(`e:${email.toLowerCase()}`).toString('hex').slice(0, 8)}@example.invalid`; }

    /** Returns an anonymised deep copy. Team words are never replaced, even where they occur in a name. */
    anonymise<T extends Json>(data: T): T {
        const teamWords = new Set<string>();
        const names: string[] = [];
        const walk = (v: Json, key = '') => {
            if (Array.isArray(v)) return v.forEach(x => walk(x, key));
            if (v && typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(x, k));
            if (typeof v !== 'string') return;
            if (/^t[12]Name$|team|ground|series|league|club/i.test(key)) v.split(/[^\p{L}']+/u).forEach(w => w && teamWords.add(w.toLowerCase()));
            else if (PERSON_KEY.test(key)) names.push(v);
            // Fielders are named only inside the dismissal HTML: <span class='outname'>Vamshi K</span>
            for (const m of v.matchAll(/class=['"]?outname['"]?>([^<]+)</g)) names.push(m[1]);
        };
        walk(data);
        for (const n of names) for (const w of n.split(/[^\p{L}']+/u)) {
            const k = w.toLowerCase();
            if (w.length >= 2 && !teamWords.has(k) && !KEEP.has(k)) this.seen.add(k);
        }
        const replace = new Set([...this.seen].filter(w => !teamWords.has(w)));
        const pattern = replace.size ? new RegExp(`(?<![\\p{L}])(${[...replace].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')).join('|')})(?![\\p{L}])`, 'giu') : null;
        const scrub = (s: string) => {
            let out = s.replace(EMAIL, m => this.fakeEmail(m));
            if (pattern) out = out.replace(pattern, m => this.fakeWord(m));
            return out;
        };
        const copy = (v: Json, key = ''): Json => {
            if (Array.isArray(v)) return v.map(x => copy(x, key));
            if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x, k)]));
            if (PERSON_ID.test(key) && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number(v) > 0) return this.fakeId(v);
            if (typeof v === 'string' && !/^t[12]Name$|team|ground|series|league|club/i.test(key)) return scrub(v);
            return v;
        };
        return copy(data) as T;
    }
}
