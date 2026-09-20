import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  YesWeHackApiError,
  apiRequest,
  buildPaginationQuery,
  buildProgramsQuery,
} from "./api.js";
import { matchTargetAgainstScopes, type ProgramScopeItem } from "./scope.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug YesWeHack invalide");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date attendue: YYYY-MM-DD");
const reportStatuses = [
  "new",
  "under_review",
  "accepted",
  "more_info",
  "resolved",
  "informative",
  "wont_fix",
  "rtfs",
  "spam",
  "out_of_scope",
  "not_applicable",
  "invalid",
  "duplicate",
  "auto_close",
] as const;

interface PageResponse<T> {
  pagination: Record<string, unknown>;
  items: T[];
}

interface ProgramListItem {
  title: string;
  slug: string;
  type: string;
  public: boolean;
  disabled: boolean;
  archived: boolean;
  bounty_reward_min?: number;
  bounty_reward_max?: number;
  report_submission_cost?: number;
  scopes_count?: number;
  last_update_at?: string;
  business_unit?: { name?: string; currency?: string };
}

export function registerAdvancedTools(server: McpServer): void {
  server.registerTool(
    "check_scope",
    {
      description:
        "Vérifie techniquement si une URL, un domaine ou une IPv4 correspond aux scopes déclarés d'un programme. Retourne aussi les exclusions à relire manuellement.",
      inputSchema: z.object({
        program_slug: slugSchema,
        target: z.string().trim().min(1).max(2_000),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ program_slug, target }) => {
      const [scopeData, program] = await Promise.all([
        apiRequest<{ items: ProgramScopeItem[] }>(`/programs/${program_slug}/scopes`),
        apiRequest<Record<string, unknown>>(`/programs/${program_slug}`),
      ]);
      return jsonResult({
        program: pick(program, ["title", "slug", "last_update_at"]),
        ...matchTargetAgainstScopes(target, scopeData.items),
        exclusions: program.out_of_scope ?? null,
      });
    },
  );

  server.registerTool(
    "search_my_reports",
    {
      description:
        "Recherche les rapports du hunter connecté par texte, programme, statut, criticité, récompense et période.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(200).optional(),
        program_slugs: z.array(slugSchema).max(50).optional(),
        statuses: z.array(z.enum(reportStatuses)).max(reportStatuses.length).optional(),
        severities: z
          .array(z.enum(["critical", "high", "medium", "low", "none"]))
          .max(5)
          .optional(),
        rewarded: z.boolean().optional(),
        start_date: dateSchema.optional(),
        end_date: dateSchema.optional(),
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      const severityCodes = { critical: "C", high: "H", medium: "M", low: "L", none: "N" };
      const body = compactObject({
        search: input.search,
        programSlugs: input.program_slugs,
        status: input.statuses,
        criticity: input.severities?.map((severity) => severityCodes[severity]),
        reward: input.rewarded === undefined ? undefined : [input.rewarded ? "1" : "0"],
        startDate: input.start_date,
        endDate: input.end_date,
      });
      const data = await apiRequest<PageResponse<Record<string, unknown>>>(
        "/v2/hunter/reports",
        {
          method: "POST",
          query: buildPaginationQuery(input.page, input.page_size),
          body,
        },
      );
      return jsonResult(data);
    },
  );

  server.registerTool(
    "get_report_activity",
    {
      description:
        "Retourne la chronologie d'un rapport du hunter. Les jetons de trackers et URL de pièces jointes sont toujours exclus.",
      inputSchema: z.object({
        report_id: z.int().positive(),
        include_available_transitions: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ report_id, include_available_transitions }) => {
      const logs = await apiRequest<{ items: Record<string, unknown>[] }>(
        `/reports/${report_id}/logs`,
      );
      const transitions = include_available_transitions
        ? await optionalRequest(`/reports/${report_id}/transitions`)
        : undefined;
      return jsonResult({
        items: logs.items.map(projectReportLog),
        ...(include_available_transitions ? { available_transitions: transitions } : {}),
      });
    },
  );

  server.registerTool(
    "my_hunter_dashboard",
    {
      description:
        "Retourne les indicateurs agrégés du hunter : rapports, statuts, criticités, récompenses et solde de crédits.",
      inputSchema: z.object({
        program_slugs: z.array(slugSchema).max(50).optional(),
        start_date: dateSchema.optional(),
        end_date: dateSchema.optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ program_slugs, start_date, end_date }) => {
      const body = compactObject({
        programSlugs: program_slugs,
        startDate: start_date,
        endDate: end_date,
      });
      const [reports, rewards, statuses, severities, user] = await Promise.all([
        dashboardRequest("/reports/count/data", body),
        dashboardRequest("/rewards/data", body),
        dashboardRequest("/reports/count/status", body),
        dashboardRequest("/reports/count/severity", body),
        apiRequest<Record<string, unknown>>("/user"),
      ]);
      return jsonResult({
        reports,
        rewards,
        statuses,
        severities,
        credit_balance_amount: user.credit_balance_amount ?? null,
      });
    },
  );

  server.registerTool(
    "recently_updated_programs",
    {
      description:
        "Liste les programmes visibles les plus récemment mis à jour afin de repérer les changements potentiels de règles ou de scopes.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(200).optional(),
        type: z.enum(["bug-bounty", "vdp-in-app"]).optional(),
        include_disabled: z.boolean().default(false),
        limit: z.int().min(1).max(50).default(20),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ search, type, include_disabled, limit }) => {
      const query = buildProgramsQuery({
        page: 1,
        pageSize: 100,
        search,
        type,
        includeDisabled: include_disabled,
      });
      const data = await apiRequest<PageResponse<ProgramListItem>>("/programs", { query });
      const items = [...data.items]
        .sort((left, right) => timestamp(right.last_update_at) - timestamp(left.last_update_at))
        .slice(0, limit)
        .map(projectProgramListItem);
      return jsonResult({ items, inspected_results: data.items.length });
    },
  );

  server.registerTool(
    "compare_programs",
    {
      description:
        "Compare côte à côte les récompenses, coûts en crédits, scopes et principales contraintes de plusieurs programmes.",
      inputSchema: z.object({
        slugs: z.array(slugSchema).min(2).max(5),
        include_rules: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ slugs, include_rules }) => {
      const uniqueSlugs = [...new Set(slugs)];
      if (uniqueSlugs.length < 2) {
        throw new Error("La comparaison exige au moins deux programmes distincts.");
      }
      const programs = await Promise.all(
        uniqueSlugs.map(async (slug) =>
          projectProgramComparison(
            await apiRequest<Record<string, unknown>>(`/programs/${slug}`),
            include_rules,
          ),
        ),
      );
      return jsonResult({ programs });
    },
  );

  server.registerTool(
    "get_program_hacktivity",
    {
      description:
        "Consulte l'activité publique récente d'un programme lorsque sa hacktivity est activée.",
      inputSchema: z.object({
        slug: slugSchema,
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ slug, page, page_size }) =>
      jsonResult(
        await optionalProgramFeatureRequest(`/programs/${slug}/hacktivity`, {
          query: buildPaginationQuery(page, page_size),
        }),
      ),
  );

  server.registerTool(
    "get_program_ranking",
    {
      description:
        "Consulte le classement des hunters d'un programme lorsque celui-ci publie un classement.",
      inputSchema: z.object({
        slug: slugSchema,
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ slug, page, page_size }) =>
      jsonResult(
        await optionalProgramFeatureRequest(`/programs/${slug}/ranking`, {
          query: buildPaginationQuery(page, page_size),
        }),
      ),
  );

  server.registerTool(
    "list_program_credentials",
    {
      description:
        "Liste les credentials de test et demandes d'accès d'un programme. Les logins, e-mails et mots de passe ne sont jamais renvoyés.",
      inputSchema: z.object({ program_slug: slugSchema }),
      annotations: readOnlyAnnotations,
    },
    async ({ program_slug }) => {
      const data = await apiRequest<Record<string, unknown>>(
        `/programs/${program_slug}/hunter/credentials`,
      );
      return jsonResult(projectCredentialsResponse(data));
    },
  );

  server.registerTool(
    "get_my_credit_history",
    {
      description:
        "Liste l'historique paginé des gains et dépenses de crédits du hunter connecté.",
      inputSchema: z.object({
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ page, page_size }) => {
      const data = await apiRequest<PageResponse<Record<string, unknown>>>(
        "/user/credits/transactions",
        { query: buildPaginationQuery(page, page_size) },
      );
      return jsonResult({
        pagination: data.pagination,
        items: data.items.map(projectCreditTransaction),
      });
    },
  );
}

async function dashboardRequest(
  suffix: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return apiRequest(`/v2/hunter/dashboard${suffix}`, { method: "POST", body });
}

async function optionalRequest(path: string): Promise<unknown> {
  try {
    return await apiRequest(path);
  } catch (error: unknown) {
    if (error instanceof YesWeHackApiError && [403, 404].includes(error.status)) {
      return { available: false, reason: `YesWeHack API ${error.status}` };
    }
    throw error;
  }
}

async function optionalProgramFeatureRequest(
  path: string,
  options: { query: URLSearchParams },
): Promise<unknown> {
  try {
    return await apiRequest(path, options);
  } catch (error: unknown) {
    if (error instanceof YesWeHackApiError && [403, 404].includes(error.status)) {
      return {
        available: false,
        reason: "Cette fonctionnalité n'est pas publiée ou n'est pas accessible pour ce programme.",
        api_status: error.status,
      };
    }
    throw error;
  }
}

function projectReportLog(log: Record<string, unknown>): object {
  const result = pick(log, [
    "id",
    "type",
    "points",
    "private",
    "assessment",
    "canceled",
    "status",
    "old_status",
    "message",
    "old_bug_type",
    "new_bug_type",
    "old_cvss",
    "new_cvss",
    "priority",
    "old_priority",
    "old_tags",
    "new_tags",
    "reward_failed",
    "reward_type",
    "bounty_reward_amount",
    "author",
    "collaborator",
    "marked_as",
    "fix_verified",
    "old_patch_status",
    "new_patch_status",
    "old_tracking_status",
    "new_tracking_status",
    "old_title",
    "new_title",
    "created_at",
    "duplicate_of",
    "assignment",
    "old_program",
    "program",
    "new_ask_for_fix_verification_status",
    "old_ask_for_fix_verification_status",
    "intended_for",
    "old_resolved_at",
    "new_resolved_at",
    "credit",
    "attachments",
  ]) as Record<string, unknown>;
  if (Array.isArray(result.attachments)) {
    result.attachments = result.attachments.map((attachment) =>
      isRecord(attachment)
        ? pick(attachment, ["id", "name", "filename", "content_type", "size"])
        : attachment,
    );
  }
  return result;
}

function projectProgramListItem(program: ProgramListItem): object {
  return {
    title: program.title,
    slug: program.slug,
    type: program.type,
    public: program.public,
    disabled: program.disabled,
    archived: program.archived,
    bounty_reward_min: program.bounty_reward_min,
    bounty_reward_max: program.bounty_reward_max,
    report_submission_cost: program.report_submission_cost,
    scopes_count: program.scopes_count,
    last_update_at: program.last_update_at,
    business_unit: program.business_unit,
  };
}

function projectProgramComparison(
  program: Record<string, unknown>,
  includeRules: boolean,
): object {
  const keys = [
    "title",
    "slug",
    "type",
    "public",
    "archived",
    "bounty",
    "gift",
    "hall_of_fame",
    "bounty_reward_min",
    "bounty_reward_max",
    "report_submission_cost",
    "reward_grid_default",
    "reward_grid_very_low",
    "reward_grid_low",
    "reward_grid_medium",
    "reward_grid_high",
    "reward_grid_critical",
    "scopes",
    "out_of_scope",
    "account_access",
    "user_agent",
    "supported_languages",
    "last_update_at",
  ];
  if (includeRules) keys.push("rules", "qualifying_vulnerability", "non_qualifying_vulnerability");
  return pick(program, keys);
}

export function projectCredentialsResponse(data: Record<string, unknown>): object {
  const container = isRecord(data.items) ? data.items : data;
  const credentials = Array.isArray(data.items)
    ? data.items
    : Array.isArray(container.credentials)
      ? container.credentials
      : [];
  const requests =
    Array.isArray(container.credential_requests)
      ? container.credential_requests
      : [];
  return {
    credentials: credentials.map((credential) => {
      if (!isRecord(credential)) return credential;
      return {
        ...pick(credential, [
          "id",
          "is_hunter_member",
          "disabled",
          "status",
          "rights",
        ]),
        user: projectNestedMetadata(credential.user),
        credential_pool: projectNestedMetadata(credential.credential_pool),
        login_present: typeof credential.login === "string" && credential.login.length > 0,
        email_present: typeof credential.email === "string" && credential.email.length > 0,
        email_alias_present:
          typeof credential.email_alias === "string" && credential.email_alias.length > 0,
        password_present:
          typeof credential.password === "string" && credential.password.length > 0,
      };
    }),
    credential_requests: requests.map((request) =>
      isRecord(request)
        ? {
            ...pick(request, ["id", "status", "created_at", "updated_at"]),
            credential_pool: projectNestedMetadata(request.credential_pool),
          }
        : request,
    ),
    secrets_redacted: true,
  };
}

function projectNestedMetadata(value: unknown): object | null {
  if (!isRecord(value)) return null;
  return pick(value, [
    "id",
    "name",
    "title",
    "slug",
    "username",
    "description",
    "type",
    "status",
    "disabled",
  ]);
}

function projectCreditTransaction(transaction: Record<string, unknown>): object {
  return pick(transaction, [
    "id",
    "type",
    "variation",
    "created_at",
    "snapshot",
    "report",
    "program",
  ]);
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined) return false;
      if (Array.isArray(item) && item.length === 0) return false;
      return true;
    }),
  );
}

function timestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(source: Record<string, unknown>, keys: string[]): object {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
