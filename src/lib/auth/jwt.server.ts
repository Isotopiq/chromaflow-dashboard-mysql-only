import { SignJWT, jwtVerify } from "jose";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) console.warn("[auth] JWT_SECRET is not set");

const key = new TextEncoder().encode(SECRET ?? "dev-insecure-secret-change-me");
const ISSUER = "chroma.lab";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = { sub: string; email: string };

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER });
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return { sub: payload.sub, email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "chroma_session";
export const SESSION_TTL_SECONDS = TTL_SECONDS;
