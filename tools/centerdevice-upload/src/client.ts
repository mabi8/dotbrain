import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_CACHE = resolve(__dirname, "..", ".token-cache.json");

export interface CDConfig {
  baseUrl: string;
  authUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface TokenCache {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export class CenterDeviceClient {
  private config: CDConfig;
  private accessToken = "";
  private refreshToken: string;
  private expiresAt = 0;

  constructor(config: CDConfig) {
    this.config = config;
    this.refreshToken = config.refreshToken;
    this.loadCache();
  }

  private get encodedCredentials(): string {
    return Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString("base64");
  }

  private loadCache(): void {
    if (!existsSync(TOKEN_CACHE)) return;
    try {
      const data = JSON.parse(readFileSync(TOKEN_CACHE, "utf-8")) as TokenCache;
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      this.expiresAt = data.expires_at;
    } catch {
      // ignore corrupt cache
    }
  }

  private saveCache(): void {
    const data: TokenCache = {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.expiresAt,
    };
    writeFileSync(TOKEN_CACHE, JSON.stringify(data, null, 2));
  }

  private isTokenExpired(): boolean {
    if (!this.expiresAt) return true;
    return Date.now() > this.expiresAt - 5 * 60 * 1000;
  }

  async refreshAccessToken(force = false): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("No refresh token. Set CD_REFRESH_TOKEN in .env");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      ...(force ? { force: "true" } : {}),
    });

    const res = await fetch(`${this.config.authUrl}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.encodedCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.saveCache();
  }

  async request(
    path: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | Buffer;
      accept?: string;
    } = {}
  ): Promise<Response> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }

    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      ...options.headers,
    };
    if (options.accept) headers["Accept"] = options.accept;
    else if (!headers["Accept"]) headers["Accept"] = "application/json";

    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body as BodyInit | undefined,
    });

    if (res.status === 401) {
      await this.refreshAccessToken(true);
      return fetch(url, {
        method: options.method || "GET",
        headers: { ...headers, Authorization: `Bearer ${this.accessToken}` },
        body: options.body as BodyInit | undefined,
      });
    }

    return res;
  }

  async jsonRequest<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const res = await this.request(path, {
      method: options.method || "GET",
      headers: options.body
        ? { "Content-Type": "application/json; charset=UTF-8" }
        : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CenterDevice API error (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ─── Upload ────────────────────────────────────────────────────────

  async uploadDocument(params: {
    filename: string;
    data: Buffer;
    contentType: string;
    title?: string;
    tags?: string[];
    collections?: string[];
    folders?: string[];
  }): Promise<{ location: string | null; [key: string]: unknown }> {
    const document: Record<string, unknown> = { filename: params.filename };
    if (params.title) document.title = params.title;

    const actions: Record<string, unknown> = {};
    if (params.collections?.length) actions["add-to-collection"] = params.collections;
    if (params.folders?.length) actions["add-to-folder"] = params.folders;
    if (params.tags?.length) actions["add-tag"] = params.tags;

    const metadata: Record<string, unknown> = { document };
    if (Object.keys(actions).length > 0) metadata.actions = actions;

    const boundary = `----CDBoundary${Date.now()}`;
    const CRLF = "\r\n";

    let head = "";
    head += `--${boundary}${CRLF}`;
    head += `Content-Disposition: form-data; name="metadata"${CRLF}`;
    head += `Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}`;
    head += JSON.stringify({ metadata }) + CRLF;
    head += `--${boundary}${CRLF}`;
    head += `Content-Disposition: form-data; name="document"; filename="${params.filename}"${CRLF}`;
    head += `Content-Type: ${params.contentType}${CRLF}${CRLF}`;

    const footer = `${CRLF}--${boundary}--${CRLF}`;

    const fullBody = Buffer.concat([
      Buffer.from(head, "utf-8"),
      params.data,
      Buffer.from(footer, "utf-8"),
    ]);

    const res = await this.request("/documents", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: fullBody,
      accept: "application/json",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload failed (${res.status}): ${text}`);
    }

    const location = res.headers.get("Location");
    const body = (await res.json()) as Record<string, unknown>;
    return { location, ...body };
  }

  async uploadNewVersion(params: {
    documentId: string;
    filename: string;
    data: Buffer;
    contentType: string;
  }): Promise<unknown> {
    const metadata = { document: { filename: params.filename } };
    const boundary = `----CDBoundary${Date.now()}`;
    const CRLF = "\r\n";

    let head = "";
    head += `--${boundary}${CRLF}`;
    head += `Content-Disposition: form-data; name="metadata"${CRLF}`;
    head += `Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}`;
    head += JSON.stringify({ metadata }) + CRLF;
    head += `--${boundary}${CRLF}`;
    head += `Content-Disposition: form-data; name="document"; filename="${params.filename}"${CRLF}`;
    head += `Content-Type: ${params.contentType}${CRLF}${CRLF}`;

    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const fullBody = Buffer.concat([
      Buffer.from(head, "utf-8"),
      params.data,
      Buffer.from(footer, "utf-8"),
    ]);

    const res = await this.request(`/document/${params.documentId}`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: fullBody,
      accept: "application/json",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload new version failed (${res.status}): ${text}`);
    }

    return res.json();
  }

  // ─── Browse ────────────────────────────────────────────────────────

  async listCollections(): Promise<unknown> {
    return this.jsonRequest("/collections");
  }

  async listFolders(params: {
    collection?: string;
    parent?: string;
  } = {}): Promise<unknown> {
    const qp = new URLSearchParams();
    if (params.collection) qp.set("collection", params.collection);
    if (params.parent) qp.set("parent", params.parent);
    const qs = qp.toString();
    return this.jsonRequest(`/folders${qs ? `?${qs}` : ""}`);
  }

  async searchDocuments(params: {
    query?: string;
    collection?: string;
    tags?: string[];
    rows?: number;
  }): Promise<unknown> {
    const searchParams: Record<string, unknown> = {};
    if (params.query) searchParams.query = { text: params.query };
    const filter: Record<string, unknown> = {};
    if (params.collection) filter.collections = [params.collection];
    if (params.tags?.length) filter.tags = params.tags;
    if (Object.keys(filter).length > 0) searchParams.filter = filter;
    searchParams.rows = params.rows || 20;

    return this.jsonRequest("/documents", {
      method: "POST",
      body: { action: "search", ...searchParams },
    });
  }

  async getCurrentUser(): Promise<unknown> {
    return this.jsonRequest("/user/current");
  }
}
