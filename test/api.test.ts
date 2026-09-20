import assert from "node:assert/strict";
import test from "node:test";
import { buildPaginationQuery, buildProgramsQuery } from "../src/api.js";

test("buildProgramsQuery serializes YesWeHack filters", () => {
  const query = buildProgramsQuery({
    page: 2,
    pageSize: 50,
    search: "dojo",
    type: "bug-bounty",
    includeDisabled: false,
  });

  assert.equal(query.get("page"), "2");
  assert.equal(query.get("resultsPerPage"), "50");
  assert.equal(query.get("filter[disabled]"), "0");
  assert.equal(query.get("filter[search]"), "dojo");
  assert.deepEqual(query.getAll("filter[type][]"), ["bug-bounty"]);
});

test("buildPaginationQuery uses API parameter names", () => {
  const query = buildPaginationQuery(3, 25);
  assert.equal(query.toString(), "page=3&resultsPerPage=25");
});
