import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { TOTP, URI } from "otpauth";

const API_BASE_URL = "https://api.yeswehack.com";
const AUTH_TIMEOUT_MS = 20_000;
const TOKEN_EXPIRY_SKEW_MS = 30_000;
const UNKNOWN_TOKEN_TTL_MS = 5 * 60_000;

export interface YesWeHackCredentials {
  email: string;
  password: string;
  totpKey: string;
}

interface AuthenticationPayload {
  token?: unknown;
  ttl?: unknown;
  totp_token?: unknown;
  idp_url?: unknown;
}

export interface CachedToken {
  value: string;
  expiresAt: number;
}

type AuthPost = (path: string, body: Record<string, unknown>) => Promise<unknown>;

let cachedToken: CachedToken | undefined;
let authenticationInFlight: Promise<CachedToken> | undefined;
const envFilePath = loadEnvironment();

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_SKEW_MS > now) {
    return cachedToken.value;
  }

  authenticationInFlight ??= authenticate(readCredentials()).finally(() => {
    authenticationInFlight = undefined;
  });
  cachedToken = await authenticationInFlight;
  return cachedToken.value;
}

export function invalidateAccessToken(token?: string): void {
  if (!token || cachedToken?.value === token) cachedToken = undefined;
}

export async function getSessionStatus(): Promise<{
  configured: boolean;
  authenticated: boolean;
  authentication: "credentials+totp";
  envFile: string | null;
  missingVariables: string[];
  tokenCached: boolean;
  tokenExpiresAt?: string;
}> {
  const missingVariables = getMissingVariables();
  if (missingVariables.length > 0) {
    return {
      configured: false,
      authenticated: false,
      authentication: "credentials+totp",
      envFile: envFilePath ? ".env" : null,
      missingVariables,
      tokenCached: false,
    };
  }

  await getAccessToken();
  const token = cachedToken;
  return {
    configured: true,
    authenticated: Boolean(token),
    authentication: "credentials+totp",
    envFile: envFilePath ? ".env" : null,
    missingVariables: [],
    tokenCached: Boolean(token),
    ...(token ? { tokenExpiresAt: new Date(token.expiresAt).toISOString() } : {}),
  };
}

export async function authenticate(
  credentials: YesWeHackCredentials,
  post: AuthPost = postAuthentication,
  now = Date.now(),
): Promise<CachedToken> {
  const loginPayload = parseAuthenticationPayload(
    await post("/login", {
      email: credentials.email,
      password: credentials.password,
    }),
  );

  if (typeof loginPayload.idp_url === "string") {
    throw new Error(
      "Ce compte YesWeHack impose une connexion SSO, incompatible avec les identifiants configurés.",
    );
  }

  if (typeof loginPayload.token === "string") {
    return cacheableToken(loginPayload.token, loginPayload.ttl, now);
  }

  if (typeof loginPayload.totp_token !== "string") {
    throw new Error("Réponse de connexion YesWeHack inattendue.");
  }

  const code = generateTotp(credentials.totpKey, now);
  const totpPayload = parseAuthenticationPayload(
    await post("/account/totp", {
      token: loginPayload.totp_token,
      code,
    }),
  );
  if (typeof totpPayload.token !== "string") {
    throw new Error("YesWeHack n'a pas renvoyé de jeton après la validation TOTP.");
  }
  return cacheableToken(totpPayload.token, totpPayload.ttl, now);
}

export function generateTotp(secretValue: string, timestamp = Date.now()): string {
  const value = secretValue.trim();
  if (!value) throw new Error("YESWEHACK_TOPT_KEY est vide.");

  try {
    if (value.startsWith("otpauth://")) {
      const otp = URI.parse(value);
      if (!(otp instanceof TOTP)) {
        throw new Error("l'URI configure HOTP au lieu de TOTP");
      }
      return otp.generate({ timestamp });
    }

    return new TOTP({
      issuer: "YesWeHack",
      label: "YesWeHack",
      secret: value.replace(/\s+/g, "").toUpperCase(),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }).generate({ timestamp });
  } catch (error: unknown) {
    throw new Error(
      `YESWEHACK_TOPT_KEY n'est pas un secret TOTP valide. ${describeError(error)}`,
    );
  }
}

export function readCredentials(
  env: NodeJS.ProcessEnv = process.env,
): YesWeHackCredentials {
  const email = env.YESWEHACK_EMAIL?.trim() ?? "";
  const password = env.YESWEHACK_PASSWORD ?? "";
  const totpKey =
    (env.YESWEHACK_TOPT_KEY ?? env.YESWEHACK_TOTP_KEY)?.trim() ?? "";
  const missing = getMissingVariables(env);
  if (missing.length > 0) {
    throw new Error(
      `Configuration YesWeHack incomplète dans .env : ${missing.join(", ")}.`,
    );
  }
  return { email, password, totpKey };
}

function getMissingVariables(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.YESWEHACK_EMAIL?.trim()) missing.push("YESWEHACK_EMAIL");
  if (!env.YESWEHACK_PASSWORD) missing.push("YESWEHACK_PASSWORD");
  if (!(env.YESWEHACK_TOPT_KEY ?? env.YESWEHACK_TOTP_KEY)?.trim()) {
    missing.push("YESWEHACK_TOPT_KEY");
  }
  return missing;
}

async function postAuthentication(
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    if (path === "/login" && response.status === 401) {
      throw new Error("Identifiants YesWeHack invalides.");
    }
    if (path === "/account/totp" && [400, 401, 404].includes(response.status)) {
      throw new Error(
        "Validation TOTP refusée. Vérifie YESWEHACK_TOTP_KEY et la synchronisation de l'horloge.",
      );
    }
    throw new Error(`Authentification YesWeHack ${response.status}: ${detail}`);
  }
  return response.json() as Promise<unknown>;
}

function parseAuthenticationPayload(value: unknown): AuthenticationPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Réponse d'authentification YesWeHack invalide.");
  }
  return value as AuthenticationPayload;
}

function cacheableToken(token: string, ttl: unknown, now: number): CachedToken {
  const jwtExpiry = getJwtExpiry(token);
  const ttlExpiry =
    typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0
      ? now + ttl * 1_000
      : undefined;
  return {
    value: token,
    expiresAt: jwtExpiry ?? ttlExpiry ?? now + UNKNOWN_TOKEN_TTL_MS,
  };
}

function getJwtExpiry(token: string): number | undefined {
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1_000
      : undefined;
  } catch {
    return undefined;
  }
}

function loadEnvironment(): string | null {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const configuredPath = process.env.YESWEHACK_ENV_FILE;
  const candidates = [
    configuredPath,
    join(process.cwd(), ".env"),
    resolve(moduleDirectory, "../.env"),
    resolve(moduleDirectory, "../../.env"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return null;
  dotenv.config({ path, quiet: true });
  return path;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Keep authentication errors concise and never include request data.
  }
  return response.statusText || "requête refusée";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
