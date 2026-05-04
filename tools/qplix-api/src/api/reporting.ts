import { QplixConfig } from "../config.js";
import { request } from "../client.js";
import { writeFileSync } from "fs";

export interface ListReportsOpts {
  legalEntityIds?: string[];
  releasedOnly?: boolean;
  unReleasedOnly?: boolean;
  name?: string;
  createdOn?: string;
  exactDueDate?: string;
  dueDate?: string;
  startDate?: string;
  clientId?: string;
  onlyUnread?: boolean;
  combineMultiReports?: boolean;
  skip?: number;
  limit?: number;
}

export async function listReports(
  config: QplixConfig,
  opts: ListReportsOpts = {}
): Promise<unknown> {
  return request(config, "GET", "/qapi/v1/reporting/reports", {
    query: {
      LegalEntityIds: opts.legalEntityIds,
      ReleasedOnly: opts.releasedOnly,
      UnReleasedOnly: opts.unReleasedOnly,
      Name: opts.name,
      CreatedOn: opts.createdOn,
      ExactDueDate: opts.exactDueDate,
      DueDate: opts.dueDate,
      StartDate: opts.startDate,
      ClientId: opts.clientId,
      OnlyUnread: opts.onlyUnread,
      CombineMultiReports: opts.combineMultiReports,
      Skip: opts.skip,
      Limit: opts.limit,
    },
  });
}

export async function getReport(config: QplixConfig, id: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/reporting/reports/${id}`);
}

export async function listReportTemplates(
  config: QplixConfig,
  opts: { skip?: number; limit?: number; sortByNameAscending?: boolean } = {}
): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/reporting/reportTemplates`, {
    query: {
      Skip: opts.skip,
      Limit: opts.limit,
      sortByNameAscending: opts.sortByNameAscending,
    },
  });
}

export async function getReportTemplate(config: QplixConfig, id: string): Promise<unknown> {
  return request(config, "GET", `/qapi/v1/reporting/reportTemplates/${id}`);
}

export async function downloadReportPdf(
  config: QplixConfig,
  reportId: string,
  outPath: string
): Promise<void> {
  const res = (await request(
    config,
    "GET",
    `/qapi/v1/reporting/reports/${reportId}/pdf`,
    { accept: "application/pdf", raw: true }
  )) as Response;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PDF ${reportId} → ${res.status}: ${text.slice(0, 500)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
}
