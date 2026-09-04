import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { verifyAccessJwt, extractAccessToken } from './access';

const TEAM = 'unit-test.cloudflareaccess.com';
const AUD = 'aud-123';

function b64url(data: ArrayBuffer | string): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let privateKey: CryptoKey;
let jwks: { keys: Record<string, unknown>[] };

async function sign(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'kid-1' }) {
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
    return `${signingInput}.${b64url(sig)}`;
}

const validPayload = () => ({ aud: [AUD], iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600, email: 'a@b.c' });

beforeAll(async () => {
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']
    ) as CryptoKeyPair;
    privateKey = pair.privateKey;
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    jwks = { keys: [{ ...pub, kid: 'kid-1' }] };
});

describe('verifyAccessJwt', () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(jwks), { status: 200 }));

    beforeAll(() => vi.stubGlobal('fetch', fetchMock));
    afterEach(() => fetchMock.mockClear());

    it('accepts a token signed by a key in the team JWKS with the right audience and issuer', async () => {
        expect(await verifyAccessJwt(await sign(validPayload()), TEAM, AUD)).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(`https://${TEAM}/cdn-cgi/access/certs`);
    });

    it('caches the JWKS between verifications', async () => {
        await verifyAccessJwt(await sign(validPayload()), TEAM, AUD);
        await verifyAccessJwt(await sign(validPayload()), TEAM, AUD);
        expect(fetchMock).not.toHaveBeenCalled(); // cached by the first test in this file
    });

    it('rejects an expired token', async () => {
        expect(await verifyAccessJwt(await sign({ ...validPayload(), exp: Math.floor(Date.now() / 1000) - 1 }), TEAM, AUD)).toBe(false);
    });

    it('rejects the wrong audience, as string or array', async () => {
        expect(await verifyAccessJwt(await sign({ ...validPayload(), aud: ['other'] }), TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt(await sign({ ...validPayload(), aud: 'other' }), TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt(await sign({ ...validPayload(), aud: AUD }), TEAM, AUD)).toBe(true);
    });

    it('rejects the wrong issuer', async () => {
        expect(await verifyAccessJwt(await sign({ ...validPayload(), iss: 'https://evil.example' }), TEAM, AUD)).toBe(false);
    });

    it('rejects an unknown key id and a non-RS256 header', async () => {
        expect(await verifyAccessJwt(await sign(validPayload(), { alg: 'RS256', kid: 'nope' }), TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt(await sign(validPayload(), { alg: 'HS256', kid: 'kid-1' }), TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt(await sign(validPayload(), { alg: 'RS256' }), TEAM, AUD)).toBe(false);
    });

    it('rejects a tampered payload', async () => {
        const token = await sign(validPayload());
        const [h, , s] = token.split('.');
        const forged = `${h}.${b64url(JSON.stringify({ ...validPayload(), email: 'attacker@evil' }))}.${s}`;
        expect(await verifyAccessJwt(forged, TEAM, AUD)).toBe(false);
    });

    it('rejects malformed tokens without throwing', async () => {
        expect(await verifyAccessJwt('', TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt('a.b', TEAM, AUD)).toBe(false);
        expect(await verifyAccessJwt('not.base64.json', TEAM, AUD)).toBe(false);
    });
});

describe('extractAccessToken', () => {
    it('prefers the Cf-Access-Jwt-Assertion header', () => {
        const req = new Request('https://x/stats', { headers: { 'Cf-Access-Jwt-Assertion': 'hdr', Cookie: 'CF_Authorization=cookie' } });
        expect(extractAccessToken(req)).toBe('hdr');
    });

    it('falls back to the CF_Authorization cookie among other cookies', () => {
        const req = new Request('https://x/stats', { headers: { Cookie: 'a=1; CF_Authorization=tok.en.x; b=2' } });
        expect(extractAccessToken(req)).toBe('tok.en.x');
    });

    it('returns null when neither is present', () => {
        expect(extractAccessToken(new Request('https://x/stats'))).toBeNull();
    });
});
