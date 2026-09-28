import { describe, it, expect } from 'vitest';
import { Anonymiser } from './anonymise.ts';
import { mock_view_1, mock_view_2 } from '../src/mockData';

const a = () => new Anonymiser('test-salt');

describe('Anonymiser', () => {
    it('replaces player names consistently, keeping initials, and leaves team names alone', () => {
        const an = a();
        const out = an.anonymise({ values: { t1Name: 'AVV XI', t2Name: 'Vertex Vikings', batsman1Name: 'Anand S', manOfTheMatch: 'Anand Babu Sharma', lastOutString: "<span>c &#8224; </span><span class='outname'>Vamshi K</span><span> b </span><span class='outname'>Anand S</span>", result: 'AVV XI won by 2 Runs' } } as any) as any;
        const [first, init] = out.values.batsman1Name.split(' ');
        expect(first).not.toBe('Anand');
        expect(first[0]).toBe('A');
        expect(init).toBe('S');
        expect(out.values.manOfTheMatch.startsWith(first)).toBe(true);                    // same word, same fake
        expect(out.values.lastOutString).toContain(`>${first} S<`);
        expect(out.values.lastOutString).not.toContain('Vamshi');                        // fielders only live in the HTML
        expect(out.values.lastOutString).toContain('&#8224;');                           // the markup itself is untouched
        expect(out.values.t1Name).toBe('AVV XI');
        expect(out.values.result).toBe('AVV XI won by 2 Runs');
    });

    it('keeps a fielder hidden in later frames once seen', () => {
        const an = a();
        an.anonymise({ values: { lastOutString: "<span>c </span><span class='outname'>Vamshi K</span>" } } as any);
        const later = an.anonymise({ values: { comments: 'great catch Vamshi' } } as any) as any;
        expect(later.values.comments).not.toContain('Vamshi');
    });

    it('hides a nickname that appears only in the dismissal text (match 4686)', () => {
        const out = a().anonymise({ values: { outStringNickNamesNoLink: 'c &#8224;Zimi b Majazus M', outStringNoLink: 'c &#8224;Tipoh S b Majazus M' } } as any) as any;
        expect(out.values.outStringNickNamesNoLink).not.toContain('Zimi');
        expect(out.values.outStringNickNamesNoLink.startsWith('c &#8224;Z')).toBe(true);    // markup and initial kept
    });

    it('re-anonymising in two passes hides a name learned late in every frame', async () => {
        const { Anonymiser } = await import('./anonymise.ts');
        const an = new Anonymiser('s');
        const early = { values: { comments: 'Vamshi to bowl' } }, late = { values: { lastOutString: "<span class='outname'>Vamshi K</span>" } };
        an.prime(early as any); an.prime(late as any);
        expect(JSON.stringify(an.anonymise(early as any))).not.toContain('Vamshi');
    });

    it('replaces emails and player IDs, keeping their shape and type', () => {
        const out = a().anonymise({ values: { batsman1ID: 3061960, currentPartnershipMap: { partnershipBatsman1ID: '3061960' }, t1ID: 55, rows: [{ email: 'real.person@gmail.com', playerID: 12 }] } } as any) as any;
        expect(out.values.batsman1ID).not.toBe(3061960);
        expect(typeof out.values.batsman1ID).toBe('number');
        expect(out.values.currentPartnershipMap.partnershipBatsman1ID).toBe(String(out.values.batsman1ID));   // still the same player
        expect(out.values.t1ID).toBe(55);                                                                     // team IDs kept
        expect(out.values.rows[0].email).toMatch(/^player-[0-9a-f]{8}@example\.invalid$/);
    });

    it('leaves no real player name from a captured frame anywhere in the output', () => {
        for (const frame of [mock_view_1, mock_view_2]) {
            const real = new Set<string>();
            JSON.stringify(frame, (k, v) => { if (typeof v === 'string' && /^(batsman[12]Name|bowlerName|lastOutName|firstName|lastName)$/.test(k)) v.split(/\s+/).filter((w: string) => w.length > 2).forEach((w: string) => real.add(w)); return v; });
            const text = JSON.stringify(a().anonymise(frame as any));
            const teams = `${(frame as any).values.t1Name} ${(frame as any).values.t2Name}`;
            for (const w of real) if (!teams.includes(w)) expect(text.includes(`"${w}`) || text.includes(` ${w}"`) || text.includes(`>${w}`), w).toBe(false);
        }
    });
});
