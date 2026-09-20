import { apiRequest } from "./api.js";
import { getSessionStatus } from "./auth.js";

const session = await getSessionStatus();
const programs = await apiRequest<{ items?: unknown[] }>("/v2/hunter/access/programs");
const counts = await apiRequest<unknown>("/v2/hunter/reports/count/status", {
  method: "POST",
  body: {},
});

console.log(
  JSON.stringify(
    {
      session,
      accessibleProgramCount: programs.items?.length ?? 0,
      reportStatusCounts: counts,
    },
    null,
    2,
  ),
);

// The one-shot smoke command exits after printing its redacted checks.
process.exit(0);
