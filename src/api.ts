import { getAccessToken, invalidateAccessToken } from "./auth.js";

const API_BASE_URL = "https://api.yeswehack.com";
const REQUEST_TIMEOUT_MS = 20_000;

export interface RequestOptions {
  method?: "GET" | "POST";
  query?: URLSearchParams;
  body?: unknown;
}

export class YesWeHackApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YesWeHackApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Le chemin API doit être relatif à api.yeswehack.com.");
  }

  const url = new URL(path, API_BASE_URL);
  if (options.query) {
    url.search = options.query.toString();
  }

  let token = await getAccessToken();
  let response = await authorizedFetch(url, options, token);
  if (response.status === 401) {
    invalidateAccessToken(token);
    token = await getAccessToken();
    response = await authorizedFetch(url, options, token);
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    if (response.status === 401) {
      throw new YesWeHackApiError(
        "Authentification YesWeHack refusée après renouvellement du jeton.",
        response.status,
      );
    }
    throw new YesWeHackApiError(
      `YesWeHack API ${response.status}: ${detail}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function authorizedFetch(
  url: URL,
  options: RequestOptions,
  token: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  return fetch(url, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to the generic status text without leaking response details.
  }
  return response.statusText || "requête refusée";
}

export function buildProgramsQuery(input: {
  page: number;
  pageSize: number;
  search?: string | undefined;
  type?: "bug-bounty" | "vdp-in-app" | undefined;
  includeDisabled: boolean;
}): URLSearchParams {
  const query = new URLSearchParams({
    page: String(input.page),
    resultsPerPage: String(input.pageSize),
    "filter[disabled]": input.includeDisabled ? "1" : "0",
  });
  if (input.search) query.set("filter[search]", input.search);
  if (input.type) query.append("filter[type][]", input.type);
  return query;
}

export function buildPaginationQuery(page: number, pageSize: number): URLSearchParams {
  return new URLSearchParams({
    page: String(page),
    resultsPerPage: String(pageSize),
  });
}
