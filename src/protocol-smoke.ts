import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/src/index.js"],
  cwd: process.cwd(),
  stderr: "pipe",
});
const client = new Client({ name: "yeswehack-smoke-client", version: "0.1.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const status = await callJson("session_status", {});
  if (!getBoolean(status, "configured")) {
    console.log(
      JSON.stringify(
        {
          toolNames: tools.map((tool) => tool.name),
          configured: false,
          authenticated: false,
          apiChecks: "skipped until .env is filled",
        },
        null,
        2,
      ),
    );
  } else {
    const accessible = await callJson("list_accessible_programs", {});
    const catalog = await callJson("search_programs", {
      search: "dojo",
      page: 1,
      page_size: 1,
    });
    const program = await callJson("get_program", {
      slug: "dojo",
      include_rules: false,
    });
    const scopeCheck = await callJson("check_scope", {
      program_slug: "dojo",
      target: "https://dojo-yeswehack.com/challenge-of-the-month/dojo-54",
    });
    const credits = await callJson("get_my_credit_balance", {});
    const creditHistory = await callJson("get_my_credit_history", {
      page: 1,
      page_size: 1,
    });
    const reports = await callJson("search_my_reports", { page: 1, page_size: 1 });
    const reportItems = getArray(reports, "items");
    const firstReport = reportItems[0] as { id?: unknown } | undefined;
    const report =
      typeof firstReport?.id === "number"
        ? await callJson("get_my_report", {
            report_id: firstReport.id,
            include_attachment_urls: false,
          })
        : undefined;
    const activity =
      typeof firstReport?.id === "number"
        ? await callJson("get_report_activity", {
            report_id: firstReport.id,
            include_available_transitions: true,
          })
        : undefined;
    const dashboard = await callJson("my_hunter_dashboard", {});
    const recentPrograms = await callJson("recently_updated_programs", { limit: 2 });
    const recentSlugs = getArray(recentPrograms, "items")
      .map((item) => getString(item, "slug"))
      .filter((slug): slug is string => Boolean(slug));
    const comparison =
      recentSlugs.length >= 2
        ? await callJson("compare_programs", {
            slugs: recentSlugs.slice(0, 2),
            include_rules: false,
          })
        : undefined;
    const statusCounts = await callJson("my_report_status_counts", {});

    console.log(
      JSON.stringify(
        {
          toolNames: tools.map((tool) => tool.name),
          sessionAuthenticated: getBoolean(status, "authenticated"),
          accessibleProgramCount: getArray(accessible, "items").length,
          catalogResultCount: getArray(catalog, "items").length,
          programLookupOk: getString(program, "slug") === "dojo",
          scopeCheckOk: getString(scopeCheck, "status") === "in_scope_match",
          creditBalanceReadable:
            getNumber(credits, "credit_balance_amount") !== undefined ||
            getRecord(credits).credit_balance_amount === null,
          creditHistoryReadable: getArray(creditHistory, "items").length <= 1,
          reportPageCount: reportItems.length,
          reportLookupOk:
            report === undefined || getNumber(report, "id") === firstReport?.id,
          reportActivityReadable:
            activity === undefined || Array.isArray(getRecord(activity).items),
          dashboardReadable: Boolean(getRecord(dashboard).reports),
          recentProgramsReadable: recentSlugs.length > 0,
          comparisonReadable:
            comparison === undefined || getArray(comparison, "programs").length >= 2,
          reportStatusCount: getArray(statusCounts, "items").length,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await transport.close();
}

async function callJson(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`MCP tool ${name} returned an error`);
  }
  const text = result.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`MCP tool ${name} returned no text payload`);
  }
  return JSON.parse(text.text) as unknown;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getArray(value: unknown, key: string): unknown[] {
  const candidate = getRecord(value)[key];
  return Array.isArray(candidate) ? candidate : [];
}

function getString(value: unknown, key: string): string | undefined {
  const candidate = getRecord(value)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function getNumber(value: unknown, key: string): number | undefined {
  const candidate = getRecord(value)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const candidate = getRecord(value)[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}
