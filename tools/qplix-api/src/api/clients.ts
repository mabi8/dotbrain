import { QplixConfig } from "../config.js";
import { request } from "../client.js";

export async function listClients(
  config: QplixConfig,
  opts: { skip?: number; limit?: number } = {}
): Promise<unknown> {
  return request(config, "GET", "/qapi/v1/clients", {
    query: { Skip: opts.skip, Limit: opts.limit },
  });
}

export async function getClient(config: QplixConfig, clientId: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/clients/${clientId}`);
}

export async function getClientGroups(config: QplixConfig, clientId: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/clients/${clientId}/groups`);
}

export async function getClientTransactionQueryResults(
  config: QplixConfig,
  clientId: string,
  presetId: string
): Promise<unknown> {
  return request(
    config,
    "GET",
    `/qapi/v1/clients/${clientId}/transactionQueryResults/${presetId}`
  );
}
