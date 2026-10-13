import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface HhOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  userAgent: string;
  tokenFile: string;
}

export interface HhToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing " + name + " in local .env");
  return value;
}

export function configFromEnv(): HhOAuthConfig {
  const config = {
    clientId: required("HH_CLIENT_ID"),
    clientSecret: required("HH_CLIENT_SECRET"),
    redirectUri: process.env.HH_REDIRECT_URI?.trim() || "http://127.0.0.1:8765/callback",
    userAgent: required("HH_USER_AGENT"),
    tokenFile: resolve(process.env.HH_TOKEN_FILE || ".secrets/hh-token.json")
  };
  const uri = new URL(config.redirectUri);
  if (uri.protocol !== "http:" || uri.hostname !== "127.0.0.1" ||
      !uri.port || uri.username || uri.password || uri.search || uri.hash) {
    throw new Error("HH_REDIRECT_URI must be a local http://127.0.0.1:PORT/path callback");
  }
  return config;
}

export function createVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function authorizationUrl(config: HhOAuthConfig, state: string, verifier: string): string {
  const url = new URL("https://hh.ru/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function stateMatches(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertCallback(url: URL, expectedState: string): string {
  if (url.searchParams.has("error")) throw new Error("Authorization was denied or failed");
  if (!stateMatches(url.searchParams.get("state") || "", expectedState)) {
    throw new Error("OAuth state validation failed");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("OAuth callback has no authorization code");
  return code;
}

export async function tokenRequest(
  config: HhOAuthConfig, body: URLSearchParams
): Promise<HhToken> {
  const response = await fetch("https://api.hh.ru/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "HH-User-Agent": config.userAgent
    },
    body,
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new Error("HH OAuth token request failed: HTTP " + response.status +
      " (check app permissions, redirect URI, or expired code)");
  }
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" ||
    !("access_token" in raw) || typeof raw.access_token !== "string" ||
    !("refresh_token" in raw) || typeof raw.refresh_token !== "string" ||
    !("expires_in" in raw) || typeof raw.expires_in !== "number" ||
    raw.expires_in <= 0) {
    throw new Error("Invalid HH OAuth token response");
  }
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_at: Date.now() + raw.expires_in * 1000
  };
}

export async function writeToken(path: string, token: HhToken): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(tmp, JSON.stringify(token), { mode: 0o600, flag: "wx" });
  await rename(tmp, path);
  await chmod(path, 0o600);
}

export async function readToken(path: string): Promise<HhToken> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!raw || typeof raw !== "object" ||
    !("access_token" in raw) || typeof raw.access_token !== "string" ||
    !("refresh_token" in raw) || typeof raw.refresh_token !== "string" ||
    !("expires_at" in raw) || typeof raw.expires_at !== "number") {
    throw new Error("Corrupt HH token file");
  }
  return { access_token: raw.access_token, refresh_token: raw.refresh_token, expires_at: raw.expires_at };
}

export async function accessToken(config: HhOAuthConfig): Promise<string> {
  const token = await readToken(config.tokenFile);
  if (token.expires_at > Date.now()) return token.access_token;

  // HH refresh tokens are single-use; refresh only when the access token expires.
  const updated = await tokenRequest(config, new URLSearchParams({
    grant_type: "refresh_token", client_id: config.clientId,
    client_secret: config.clientSecret, refresh_token: token.refresh_token
  }));
  await writeToken(config.tokenFile, updated);
  return updated.access_token;
}

export async function authorizeLocally(config: HhOAuthConfig): Promise<void> {
  const redirect = new URL(config.redirectUri);
  const verifier = createVerifier();
  const state = randomBytes(32).toString("hex");
  let finish!: (code: string) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
  const server = createServer((req, res) => {
    const incoming = new URL(req.url || "/", config.redirectUri);
    if (req.method !== "GET" || incoming.pathname !== redirect.pathname) {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      const code = assertCallback(incoming, state);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization received. You can close this tab.");
      finish(code);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization failed.");
      fail(error instanceof Error ? error : new Error("OAuth callback failed"));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(redirect.port), "127.0.0.1", resolve);
    });
    console.log("Open this URL in your browser to authorize JobHunter:\n");
    console.log(authorizationUrl(config, state, verifier));
    console.log("\nWaiting for the local callback (3-minute timeout)...");
    const code = await Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OAuth callback timed out")), 180_000))
    ]);
    const token = await tokenRequest(config, new URLSearchParams({
      grant_type: "authorization_code", client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, code, code_verifier: verifier
    }));
    await writeToken(config.tokenFile, token);
    console.log("HH OAuth credentials saved locally with restricted file permissions.");
  } finally {
    server.close();
  }
}
