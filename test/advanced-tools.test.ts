import assert from "node:assert/strict";
import test from "node:test";
import { projectCredentialsResponse } from "../src/advanced-tools.js";

test("projects the root-level credentials response and redacts every secret", () => {
  const projected = projectCredentialsResponse({
    credentials: [
      {
        id: 42,
        status: "active",
        login: "secret-login",
        email: "secret@example.test",
        email_alias: "alias@example.test",
        password: "secret-password",
        user: { id: 7, username: "hunter", email: "private@example.test" },
        credential_pool: { id: 3, name: "Test accounts", password: "nested-secret" },
      },
    ],
    credential_requests: [
      {
        id: 9,
        status: "pending",
        credential_pool: { id: 3, name: "Test accounts", login: "nested-login" },
      },
    ],
  });

  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("secret-login"), false);
  assert.equal(serialized.includes("secret@example.test"), false);
  assert.equal(serialized.includes("alias@example.test"), false);
  assert.equal(serialized.includes("secret-password"), false);
  assert.equal(serialized.includes("nested-secret"), false);
  assert.equal(serialized.includes("nested-login"), false);
  assert.deepEqual(projected, {
    credentials: [
      {
        id: 42,
        status: "active",
        user: { id: 7, username: "hunter" },
        credential_pool: { id: 3, name: "Test accounts" },
        login_present: true,
        email_present: true,
        email_alias_present: true,
        password_present: true,
      },
    ],
    credential_requests: [
      {
        id: 9,
        status: "pending",
        credential_pool: { id: 3, name: "Test accounts" },
      },
    ],
    secrets_redacted: true,
  });
});

test("supports the documented items wrapper", () => {
  assert.deepEqual(
    projectCredentialsResponse({
      items: { credentials: [], credential_requests: [] },
    }),
    { credentials: [], credential_requests: [], secrets_redacted: true },
  );
});
