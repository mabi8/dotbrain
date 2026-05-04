import { QplixConfig } from "../config.js";
import { request, QueryValue } from "../client.js";

export interface ListLegalEntitiesOpts {
  search?: string;
  virtualEntityIds?: string[];
  properties?: string[];
  includeVirtualEntities?: boolean;
  skip?: number;
  limit?: number;
}

export async function listLegalEntities(
  config: QplixConfig,
  opts: ListLegalEntitiesOpts = {}
): Promise<unknown> {
  return request(config, "GET", "/qapi/v1/legalEntities", {
    query: {
      Search: opts.search,
      VirtualEntityIds: opts.virtualEntityIds,
      Properties: opts.properties,
      IncludeVirtualEntities: opts.includeVirtualEntities,
      Skip: opts.skip,
      Limit: opts.limit,
    },
  });
}

export async function getLegalEntity(
  config: QplixConfig,
  id: string,
  opts: { includeInheritedProperties?: boolean } = {}
): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/legalEntities/${id}`, {
    query: { includeInheritedProperties: opts.includeInheritedProperties },
  });
}

export async function getCustodians(config: QplixConfig, id: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/legalEntities/${id}/custodians`);
}

export async function getBankAccounts(
  config: QplixConfig,
  id: string,
  custodianId: string
): Promise<unknown> {
  return request(
    config,
    "GET",
    `/qapi/v1/legalEntities/${id}/custodians/${custodianId}/bankAccounts`
  );
}

export async function getProperties(config: QplixConfig, id: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/legalEntities/${id}/properties`);
}

export async function getDocumentTree(
  config: QplixConfig,
  id: string,
  path?: string
): Promise<unknown> {
  const url = path
    ? `/qapi/v1/legalEntities/${id}/documentTree/${encodeURIComponent(path)}`
    : `/qapi/v1/legalEntities/${id}/documentTree`;
  return request(config, "GET", url);
}

/** Run a saved query preset against the legal entity (positions/holdings). */
export interface QueryResultsOpts {
  groupId?: string;
  respectHide?: boolean;
  addBenchmarkLines?: boolean;
  interval?: string;
  startDate?: string;
  dueDate?: string;
  groupingType?: string;
  classifications?: string[];
  excludedClassifications?: string[];
}

export async function getQueryResults(
  config: QplixConfig,
  id: string,
  presetId: string,
  opts: QueryResultsOpts = {}
): Promise<unknown> {
  const query: Record<string, QueryValue> = {
    GroupId: opts.groupId,
    RespectHide: opts.respectHide,
    AddBenchmarkLines: opts.addBenchmarkLines,
    Interval: opts.interval,
    StartDate: opts.startDate,
    DueDate: opts.dueDate,
    GroupingType: opts.groupingType,
    Classifications: opts.classifications,
    ExcludedClassifications: opts.excludedClassifications,
  };
  return request(config, "GET", `/qapi/v1/legalEntities/${id}/queryResults/${presetId}`, {
    query,
  });
}

/** Run a saved transaction preset (cash/securities movements). */
export interface TransactionQueryOpts {
  clientGroupId?: string;
  from?: string;
  dueDate?: string;
}

export async function getTransactionQueryResults(
  config: QplixConfig,
  id: string,
  presetId: string,
  opts: TransactionQueryOpts = {}
): Promise<unknown> {
  return request(
    config,
    "GET",
    `/qapi/v1/legalEntities/${id}/transactionQueryResults/${presetId}`,
    {
      query: {
        ClientGroupId: opts.clientGroupId,
        From: opts.from,
        DueDate: opts.dueDate,
      },
    }
  );
}
