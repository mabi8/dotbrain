import { QplixConfig } from "../config.js";
import { Method, request } from "../client.js";

export async function raw(
  config: QplixConfig,
  method: Method,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {}
): Promise<unknown> {
  return request(config, method, path, opts);
}
