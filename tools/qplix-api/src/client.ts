import { QplixConfig } from "./config.js";
import { getCookieHeader } from "./auth/token-cache.js";

export type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type QueryValue = string | number | boolean | string[] | undefined;

export interface RequestOpts {
  query?: Record<string, QueryValue>;
  body?: unknown;
  accept?: string;
  /** return raw Response instead of parsed JSON (for binary endpoints like /pdf) */
  raw?: boolean;
}

export class QplixError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function buildUrl(baseUrl: string, path: string, query?: RequestOpts["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.append(k, String(v));
      }
    }
  }
  return url.toString();
}

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

export async function request<T = unknown>(
  config: QplixConfig,
  method: Method,
  path: string,
  opts: RequestOpts = {}
): Promise<T> {
  const url = buildUrl(config.baseUrl, path, opts.query);
  const cookieHeader = await getCookieHeader();

  // /qapi/v1/* authenticates by cookie only. The application is strict about
  // the request looking SPA-shaped: Referer to /InvestorPortal/ and an
  // X-Frontend-Route header. No Authorization header.
  const headers: Record<string, string> = {
    Cookie: cookieHeader,
    Accept: opts.accept ?? "application/json, text/plain, */*",
    Referer: `${config.baseUrl}/InvestorPortal/`,
    "X-Frontend-Route": "/portal",
    "User-Agent": BROWSER_UA,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (opts.raw) return res as unknown as T;

  const text = await res.text();
  let parsed: unknown = text;
  if (text && (res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as text
    }
  }

  if (!res.ok) {
    throw new QplixError(
      res.status,
      parsed,
      `${method} ${path} → ${res.status} ${res.statusText}`
    );
  }

  return parsed as T;
}
