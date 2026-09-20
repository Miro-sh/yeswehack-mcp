import { isIP } from "node:net";

export interface ProgramScopeItem {
  scope: string;
  scope_type?: string;
  scope_type_name?: string;
  asset_value?: string;
  report_count?: number | null;
}

export interface ScopeMatch {
  scope: ProgramScopeItem;
  match_type: "url" | "hostname" | "wildcard_hostname" | "ip" | "ipv4_cidr";
}

export function matchTargetAgainstScopes(
  targetValue: string,
  scopes: ProgramScopeItem[],
): {
  status: "in_scope_match" | "no_match" | "manual_review";
  normalized_target: string;
  matches: ScopeMatch[];
  unsupported_scopes: string[];
  warning: string;
} {
  const target = parseTarget(targetValue);
  const matches: ScopeMatch[] = [];
  const unsupportedScopes: string[] = [];

  for (const scope of scopes) {
    const matchType = matchScope(target, scope.scope);
    if (matchType) matches.push({ scope, match_type: matchType });
    else if (!isSupportedScope(scope.scope)) unsupportedScopes.push(scope.scope);
  }

  return {
    status:
      matches.length > 0
        ? "in_scope_match"
        : unsupportedScopes.length > 0
          ? "manual_review"
          : "no_match",
    normalized_target: target.normalized,
    matches,
    unsupported_scopes: unsupportedScopes,
    warning:
      "Une correspondance technique ne remplace pas la lecture des règles et exclusions du programme.",
  };
}

interface ParsedTarget {
  raw: string;
  normalized: string;
  hostname?: string;
  protocol?: string;
  pathname?: string;
  ip?: string;
}

function parseTarget(value: string): ParsedTarget {
  const raw = value.trim();
  const directIp = stripIpv6Brackets(raw);
  if (isIP(directIp)) return { raw, normalized: directIp, hostname: directIp, ip: directIp };

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const hostname = stripIpv6Brackets(url.hostname.toLowerCase());
    return {
      raw,
      normalized: `${url.protocol}//${hostname}${normalizePath(url.pathname)}`,
      hostname,
      ...(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? { protocol: url.protocol } : {}),
      pathname: normalizePath(url.pathname),
      ...(isIP(hostname) ? { ip: hostname } : {}),
    };
  } catch {
    return { raw, normalized: raw.toLowerCase() };
  }
}

function matchScope(target: ParsedTarget, scopeValue: string): ScopeMatch["match_type"] | null {
  const scope = scopeValue.trim();
  if (!scope) return null;

  const cidr = parseIpv4Cidr(scope);
  if (cidr && target.ip && isIpv4InCidr(target.ip, cidr.network, cidr.bits)) {
    return "ipv4_cidr";
  }

  const scopeIp = stripIpv6Brackets(scope);
  if (isIP(scopeIp) && target.ip === scopeIp) return "ip";

  if (scope.startsWith("*.")) {
    const suffix = scope.slice(2).toLowerCase();
    if (target.hostname && target.hostname.endsWith(`.${suffix}`)) {
      return "wildcard_hostname";
    }
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(scope)) {
    try {
      const scopeUrl = new URL(scope);
      if (!target.hostname || target.hostname !== scopeUrl.hostname.toLowerCase()) return null;
      if (target.protocol && target.protocol !== scopeUrl.protocol) return null;
      const scopePath = normalizePath(scopeUrl.pathname);
      const targetPath = target.pathname ?? "/";
      return pathContains(scopePath, targetPath) ? "url" : null;
    } catch {
      return null;
    }
  }

  if (isHostname(scope) && target.hostname === scope.toLowerCase()) return "hostname";
  return null;
}

function isSupportedScope(scopeValue: string): boolean {
  const scope = scopeValue.trim();
  if (!scope) return true;
  if (parseIpv4Cidr(scope) || isIP(stripIpv6Brackets(scope))) return true;
  if (scope.startsWith("*.") && isHostname(scope.slice(2))) return true;
  if (isHostname(scope)) return true;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(scope)) {
    try {
      new URL(scope);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isHostname(value: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(
    value,
  );
}

function normalizePath(value: string): string {
  if (!value || value === "/") return "/";
  return value.replace(/\/+$/, "") || "/";
}

function pathContains(scopePath: string, targetPath: string): boolean {
  return (
    scopePath === "/" ||
    targetPath === scopePath ||
    targetPath.startsWith(`${scopePath}/`)
  );
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function parseIpv4Cidr(value: string): { network: string; bits: number } | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(value);
  if (!match || !match[1] || !match[2] || isIP(match[1]) !== 4) return null;
  return { network: match[1], bits: Number(match[2]) };
}

function isIpv4InCidr(ip: string, network: string, bits: number): boolean {
  if (isIP(ip) !== 4) return false;
  const ipNumber = ipv4ToNumber(ip);
  const networkNumber = ipv4ToNumber(network);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function ipv4ToNumber(value: string): number {
  return value
    .split(".")
    .map(Number)
    .reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
}
