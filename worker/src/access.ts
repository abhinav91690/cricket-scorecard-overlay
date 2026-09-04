/**
 * Verifies a Cloudflare Access JWT (RS256) against the team's published JWKS.
 * Access already blocks unauthenticated requests at the edge when configured; this makes the
 * Worker refuse to serve /stats if someone reaches it without going through Access.
 */

interface Jwk extends JsonWebKey { kid: string; }
interface Jwks { keys: Jwk[]; }

let cachedJwks: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(teamDomain: string): Promise<Jwk[]> {
    const now = Date.now();
    if (cachedJwks && cachedJwks.teamDomain === teamDomain && now - cachedJwks.fetchedAt < JWKS_TTL_MS) {
        return cachedJwks.keys;
    }
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
    const jwks = await response.json<Jwks>();
    cachedJwks = { teamDomain, keys: jwks.keys, fetchedAt: now };
    return jwks.keys;
}

function base64UrlDecode(input: string): Uint8Array {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<boolean> {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    let header: { alg?: string; kid?: string };
    let payload: { aud?: string | string[]; exp?: number; iss?: string };
    try {
        header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
        payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    } catch {
        return false;
    }
    if (header.alg !== 'RS256' || !header.kid) return false;

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return false;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return false;
    if (payload.iss !== `https://${teamDomain}`) return false;

    const jwk = (await getJwks(teamDomain)).find(k => k.kid === header.kid);
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlDecode(signatureB64), data);
}

/** Pulls the Access token from the header Cloudflare adds, or the cookie it sets. */
export function extractAccessToken(request: Request): string | null {
    const header = request.headers.get('Cf-Access-Jwt-Assertion');
    if (header) return header;
    const cookie = request.headers.get('Cookie') ?? '';
    const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
    return match ? match[1] : null;
}
