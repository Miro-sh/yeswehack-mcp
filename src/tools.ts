import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { apiRequest, buildPaginationQuery, buildProgramsQuery } from "./api.js";
import { registerAdvancedTools } from "./advanced-tools.js";
import { getSessionStatus } from "./auth.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

interface PageResponse<T> {
  pagination: Record<string, unknown>;
  items: T[];
}

interface ProgramAccess {
  title: string;
  slug: string;
  type: string;
  archived: boolean;
  demo: boolean;
  rights: string[];
}

interface ProgramSummary {
  title: string;
  slug: string;
  country: string;
  activity_area: string;
  type: string;
  public: boolean;
  disabled: boolean;
  archived: boolean;
  reports_count: number;
  bounty_reward_min: number;
  bounty_reward_max: number;
  scopes_count: number;
  last_update_at: string;
  report_submission_cost: number;
  business_unit?: { name?: string; currency?: string };
}

interface ReportSummary {
  id: number;
  local_id: string;
  title: string;
  scope: string;
  program: { title?: string; slug?: string };
  status: { workflow_state?: string };
  cvss?: { criticity?: string; vector?: string; score?: number; version?: string };
  reward?: number;
  cost_credits?: number;
  currency?: string;
  created_at?: string;
  changed_at?: string;
  ask_for_fix_verification_status?: string;
}

interface UserCreditProfile {
  credit_balance_amount: number | null;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "yeswehack", version: "0.3.0" },
    {
      instructions:
        "Serveur YesWeHack hunter en lecture seule. L'authentification utilise YESWEHACK_EMAIL, YESWEHACK_PASSWORD et YESWEHACK_TOPT_KEY depuis .env ; le jeton reste uniquement en mémoire. " +
        "Commencer par session_status. Utiliser list_accessible_programs pour les programmes privés accessibles, " +
        "search_programs pour le catalogue, check_scope avant de tester une cible, et les outils reports uniquement pour les rapports du hunter connecté. " +
        "Les credentials sensibles et URL de pièces jointes restent masqués.",
    },
  );

  server.registerTool(
    "session_status",
    {
      description:
        "Vérifie la configuration .env et l'authentification YesWeHack par identifiants et TOTP. Ne renvoie jamais les secrets ni le jeton.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => jsonResult(await getSessionStatus()),
  );

  server.registerTool(
    "list_accessible_programs",
    {
      description:
        "Liste les programmes auxquels le hunter connecté possède explicitement un accès, y compris les programmes privés.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const data = await apiRequest<{ items: ProgramAccess[] }>(
        "/v2/hunter/access/programs",
      );
      return jsonResult(data);
    },
  );

  server.registerTool(
    "search_programs",
    {
      description:
        "Recherche et pagine le catalogue de programmes visible par le hunter connecté.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(200).optional(),
        type: z.enum(["bug-bounty", "vdp-in-app"]).optional(),
        include_disabled: z.boolean().default(false),
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ search, type, include_disabled, page, page_size }) => {
      const query = buildProgramsQuery({
        page,
        pageSize: page_size,
        search,
        type,
        includeDisabled: include_disabled,
      });
      const data = await apiRequest<PageResponse<ProgramSummary>>("/programs", { query });
      return jsonResult(data);
    },
  );

  server.registerTool(
    "get_program",
    {
      description:
        "Récupère les règles, scopes, exclusions, récompenses et contraintes d'un programme à partir de son slug.",
      inputSchema: z.object({
        slug: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug YesWeHack invalide"),
        include_rules: z.boolean().default(true),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ slug, include_rules }) => {
      const data = await apiRequest<Record<string, unknown>>(`/programs/${slug}`);
      return jsonResult(projectProgram(data, include_rules));
    },
  );

  server.registerTool(
    "get_my_credit_balance",
    {
      description:
        "Retourne uniquement le nombre de crédits disponibles pour le hunter connecté, sans exposer les autres données du profil.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const data = await apiRequest<UserCreditProfile>("/user");
      if (data.credit_balance_amount !== null && typeof data.credit_balance_amount !== "number") {
        throw new Error("La réponse YesWeHack ne contient pas un solde de crédits valide.");
      }
      return jsonResult({ credit_balance_amount: data.credit_balance_amount });
    },
  );

  server.registerTool(
    "list_my_reports",
    {
      description:
        "Liste les rapports soumis par le hunter connecté. Cette première version fournit une pagination sans mutation ni export.",
      inputSchema: z.object({
        page: z.int().min(1).max(10_000).default(1),
        page_size: z.int().min(1).max(100).default(25),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ page, page_size }) => {
      const data = await apiRequest<PageResponse<ReportSummary>>("/v2/hunter/reports", {
        method: "POST",
        query: buildPaginationQuery(page, page_size),
        body: {},
      });
      return jsonResult(data);
    },
  );

  server.registerTool(
    "get_my_report",
    {
      description:
        "Récupère le détail d'un rapport accessible au hunter connecté. Les URL des pièces jointes sont omises par défaut.",
      inputSchema: z.object({
        report_id: z.int().positive(),
        include_attachment_urls: z.boolean().default(false),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ report_id, include_attachment_urls }) => {
      const data = await apiRequest<Record<string, unknown>>(`/reports/${report_id}`);
      return jsonResult(projectReport(data, include_attachment_urls));
    },
  );

  server.registerTool(
    "my_report_status_counts",
    {
      description: "Compte les rapports du hunter connecté par statut.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      const data = await apiRequest<unknown>("/v2/hunter/reports/count/status", {
        method: "POST",
        body: {},
      });
      return jsonResult(data);
    },
  );

  registerAdvancedTools(server);

  return server;
}

function projectProgram(data: Record<string, unknown>, includeRules: boolean): object {
  const keys = [
    "id",
    "title",
    "slug",
    "type",
    "status",
    "public",
    "archived",
    "bounty",
    "gift",
    "hall_of_fame",
    "reports_count",
    "bounty_reward_min",
    "bounty_reward_max",
    "report_submission_cost",
    "scopes",
    "out_of_scope",
    "qualifying_vulnerability",
    "non_qualifying_vulnerability",
    "reward_grid_default",
    "reward_grid_very_low",
    "reward_grid_low",
    "reward_grid_medium",
    "reward_grid_high",
    "reward_grid_critical",
    "account_access",
    "user_agent",
    "supported_languages",
    "stats",
    "last_update_at",
  ];
  if (includeRules) keys.push("rules");
  return pick(data, keys);
}

function projectReport(data: Record<string, unknown>, includeAttachmentUrls: boolean): object {
  const result = pick(data, [
    "id",
    "local_id",
    "title",
    "scope",
    "host",
    "currency",
    "reward",
    "created_at",
    "changed_at",
    "description",
    "technical_environment",
    "technical_information_html",
    "end_point",
    "vulnerable_part",
    "part_name",
    "application_finger_print",
    "payload_sample",
    "impact",
    "criticity",
    "cvss",
    "status",
    "program",
    "bug_type",
    "cve",
    "cwe",
    "patch_status",
    "tracking_status",
    "ask_for_fix_verification_status",
    "attachments",
  ]) as Record<string, unknown>;

  if (!includeAttachmentUrls && Array.isArray(result.attachments)) {
    result.attachments = result.attachments.map((attachment) => {
      if (!attachment || typeof attachment !== "object") return attachment;
      const { url: _url, ...safeAttachment } = attachment as Record<string, unknown>;
      return safeAttachment;
    });
  }
  return result;
}

function pick(source: Record<string, unknown>, keys: string[]): object {
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
