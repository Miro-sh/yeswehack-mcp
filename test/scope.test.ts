import assert from "node:assert/strict";
import test from "node:test";
import { matchTargetAgainstScopes } from "../src/scope.js";

test("matches a URL only inside its configured path", () => {
  const scopes = [{ scope: "https://example.test/app", scope_type: "web-application" }];
  assert.equal(
    matchTargetAgainstScopes("https://example.test/app/login", scopes).status,
    "in_scope_match",
  );
  assert.equal(
    matchTargetAgainstScopes("https://example.test/other", scopes).status,
    "no_match",
  );
});

test("matches wildcard hosts without matching the apex", () => {
  const scopes = [{ scope: "*.example.test" }];
  assert.equal(
    matchTargetAgainstScopes("api.example.test", scopes).status,
    "in_scope_match",
  );
  assert.equal(matchTargetAgainstScopes("example.test", scopes).status, "no_match");
});

test("matches IPv4 CIDR ranges", () => {
  const scopes = [{ scope: "192.0.2.0/24" }];
  assert.equal(matchTargetAgainstScopes("192.0.2.42", scopes).status, "in_scope_match");
  assert.equal(matchTargetAgainstScopes("192.0.3.1", scopes).status, "no_match");
});
