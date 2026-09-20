import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticate,
  generateTotp,
  readCredentials,
  type YesWeHackCredentials,
} from "../src/auth.js";

const credentials: YesWeHackCredentials = {
  email: "hunter@example.test",
  password: "not-a-real-password",
  totpKey: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
};

test("generateTotp follows the RFC 6238 SHA-1 vector", () => {
  assert.equal(generateTotp(credentials.totpKey, 59_000), "287082");
});

test("authenticate performs the YesWeHack login then TOTP exchange", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const token = makeJwt(2_000_000_000);

  const result = await authenticate(
    credentials,
    async (path, body) => {
      calls.push({ path, body });
      return path === "/login"
        ? { totp_token: "temporary-token" }
        : { token, ttl: 3_600 };
    },
    59_000,
  );

  assert.deepEqual(calls, [
    {
      path: "/login",
      body: {
        email: "hunter@example.test",
        password: "not-a-real-password",
      },
    },
    {
      path: "/account/totp",
      body: { token: "temporary-token", code: "287082" },
    },
  ]);
  assert.equal(result.value, token);
  assert.equal(result.expiresAt, 2_000_000_000_000);
});

test("readCredentials uses YESWEHACK-prefixed variables", () => {
  assert.equal(
    readCredentials({
      YESWEHACK_EMAIL: "hunter@example.test",
      YESWEHACK_PASSWORD: "secret",
      YESWEHACK_TOPT_KEY: "ABCDEF",
    }).totpKey,
    "ABCDEF",
  );
});

function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}
