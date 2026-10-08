import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authClientKey, checkToken, forgetAuthAttempts, handleAuthRequest, isSecureRequest } from "./auth.ts";
import { sameOrigin } from "./machine-security.ts";

const dir = mkdtempSync(join(tmpdir(), "herdr-auth-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => forgetAuthAttempts());

const TOKEN = "a-token-long-enough-to-be-a-real-one";
const offer = (token: string, ip: string): Promise<Response> => handleAuthRequest(
  new Request("http://192.168.0.10:7317/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }),
  TOKEN,
  ip,
);

describe("POST /api/auth", () => {
  it("answers a wrong token, and a right one, as it always did", async () => {
    expect((await offer("wrong", "10.0.0.1")).status).toBe(401);
    expect((await offer(TOKEN, "10.0.0.2")).status).toBe(204);
  });

  it("holds a run of wrong tokens back, one address at a time, and a right token spends the wait", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await offer("wrong", "10.0.0.9")).status).toBe(401);
    // the sixth ask never reaches the comparison: the address is inside its wait
    const held = await offer(TOKEN, "10.0.0.9");
    expect(held.status).toBe(429);
    expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(0);
    // another address is untouched, and the correct token spends the budget
    expect((await offer(TOKEN, "10.0.0.8")).status).toBe(204);
    forgetAuthAttempts();
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await offer("wrong", "10.0.0.7")).status).toBe(401);
    expect((await offer(TOKEN, "10.0.0.7")).status).toBe(204);
    // the run starts over after the success
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await offer("wrong", "10.0.0.7")).status).toBe(401);
    expect((await offer("wrong", "10.0.0.7")).status).toBe(401);
    expect((await offer(TOKEN, "10.0.0.7")).status).toBe(429);
  });

  it("holds nobody back when the address is unknown, and stays open with no token set", async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await handleAuthRequest(new Request("http://h/api/auth", { method: "POST", body: "{}" }), TOKEN, null)).status).toBe(400);
    }
    expect((await handleAuthRequest(new Request("http://h/api/auth", { method: "POST", body: "{}" }), "", "10.0.0.5")).status).toBe(204);
  });
});

describe("a wrong token on any gated path", () => {
  it("counts a Bearer guess, not only a POST to /api/auth", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        const check = checkToken(request, TOKEN, authClientKey(server.requestIP(request)?.address ?? null, false));
        if (url.pathname === "/api/devices" && !check.matched) {
          return check.wait > 0 ? new Response("429", { status: 429, headers: { "retry-after": String(check.wait) } }) : new Response("401", { status: 401 });
        }
        return new Response("ok");
      },
    });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      // the token is the same secret on every path, so a guess costs the client wherever it is made
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await (await fetch(`${origin}/api/devices`, { headers: { authorization: "Bearer wrong" } })).status)).toBe(401);
      const held = await fetch(`${origin}/api/devices`, { headers: { authorization: "Bearer wrong" } });
      expect(held.status).toBe(429);
      expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(0);
      // a request that offers nothing is not a guess, and costs nothing
      expect((await (await fetch(`${origin}/api/devices`)).status)).toBe(401);
      // the right token spends the wait
      expect((await (await fetch(`${origin}/api/devices`, { headers: { authorization: `Bearer ${TOKEN}` } })).status)).toBe(200);
    } finally {
      server.stop(true);
    }
  });

  it("keeps a proxied client apart from this PC's own address", () => {
    // a proxy makes every visitor share the address it connected from; without the tag, one
    // stranger's guesses spend the bucket the owner's own sign-in is counted in
    expect(authClientKey("127.0.0.1", false)).toBe("127.0.0.1");
    expect(authClientKey("127.0.0.1", true)).toBe("proxied:127.0.0.1");
    expect(authClientKey("127.0.0.1", false)).not.toBe(authClientKey("127.0.0.1", true));
    // an address the server cannot see is never held back
    expect(authClientKey(null, true)).toBe(null);
  });
});

describe("isSecureRequest", () => {
  it("marks a cookie Secure only for a request that arrived over https", () => {
    expect(isSecureRequest(new Request("https://host/api/auth"))).toBe(true);
    expect(isSecureRequest(new Request("https://host/api/auth", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isSecureRequest(new Request("http://host/api/auth"))).toBe(false);
    expect(isSecureRequest(new Request("http://host/api/auth", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});

describe("sameOrigin", () => {
  it("trusts a stated same-origin and refuses a stated cross-site one", () => {
    expect(sameOrigin(new Request("http://host/api/pane/close", { headers: { origin: "http://host" } }))).toBe(true);
    expect(sameOrigin(new Request("http://host/api/pane/close", { headers: { origin: "https://evil.invalid", "x-herdr-machine": "1" } }))).toBe(false);
    expect(sameOrigin(new Request("http://host/api/pane/close", { headers: { "sec-fetch-site": "cross-site", "x-herdr-machine": "1" } }))).toBe(false);
  });

  it("lets a request with no Origin through, so a CLI client can use the custom mutation header", () => {
    expect(sameOrigin(new Request("http://host/api/pane/close", { headers: { "x-herdr-machine": "1" } }))).toBe(true);
  });
});