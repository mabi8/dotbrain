import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DSConfig {
  integrationKey: string;
  userId: string;
  accountId: string;
  baseUri: string;
  privateKeyPath: string;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

export interface EnvelopeRecipient {
  email: string;
  name: string;
  routingOrder?: number;
}

export interface EnvelopeDocument {
  filePath: string;
  name?: string;
}

export interface CreateEnvelopeParams {
  subject: string;
  documents: EnvelopeDocument[];
  signers: EnvelopeRecipient[];
  ccRecipients?: EnvelopeRecipient[];
  message?: string;
  status?: "created" | "sent";
  useAnchors?: boolean;
}

export interface EnvelopeSummary {
  envelopeId: string;
  status: string;
  statusDateTime: string;
  uri: string;
}

export class DocuSignClient {
  private config: DSConfig;
  private token: TokenState = { accessToken: "", expiresAt: 0 };
  private privateKey: string;

  constructor(config: DSConfig) {
    this.config = config;
    const keyPath = resolve(__dirname, "..", config.privateKeyPath);
    this.privateKey = readFileSync(keyPath, "utf-8");
  }

  // ─── JWT Auth ──────────────────────────────────────────────────────

  private isTokenExpired(): boolean {
    return Date.now() > this.token.expiresAt - 60_000;
  }

  async authenticate(): Promise<void> {
    if (!this.isTokenExpired()) return;

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.config.integrationKey,
      sub: this.config.userId,
      aud: "account-d.docusign.com",
      iat: now,
      exp: now + 3600,
      scope: "signature impersonation",
    };

    const assertion = jwt.sign(payload, this.privateKey, { algorithm: "RS256" });

    const res = await fetch("https://account-d.docusign.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`JWT auth failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  // ─── API requests ──────────────────────────────────────────────────

  private get apiBase(): string {
    return `${this.config.baseUri}/restapi/v2.1/accounts/${this.config.accountId}`;
  }

  async request<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    await this.authenticate();

    const res = await fetch(`${this.apiBase}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DocuSign API error (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ─── Envelopes ─────────────────────────────────────────────────────

  async createEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeSummary> {
    const documents = params.documents.map((doc, i) => {
      const data = readFileSync(doc.filePath);
      const name = doc.name || doc.filePath.split("/").pop() || `document-${i + 1}`;
      const ext = name.split(".").pop()?.toLowerCase() || "pdf";
      return {
        documentBase64: data.toString("base64"),
        name,
        fileExtension: ext,
        documentId: String(i + 1),
      };
    });

    const signers = params.signers.map((s, i) => {
      const signer: Record<string, unknown> = {
        email: s.email,
        name: s.name,
        recipientId: String(i + 1),
        routingOrder: String(s.routingOrder ?? i + 1),
      };

      if (params.useAnchors) {
        const n = i + 1;
        signer.tabs = {
          signHereTabs: [
            { anchorString: `/sn${n}/`, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-10" },
          ],
          dateSignedTabs: [
            { anchorString: `/dt${n}/`, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-10" },
          ],
          fullNameTabs: [
            { anchorString: `/nm${n}/`, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-10" },
          ],
        };
      }

      return signer;
    });

    const carbonCopies = (params.ccRecipients || []).map((c, i) => ({
      email: c.email,
      name: c.name,
      recipientId: String(signers.length + i + 1),
      routingOrder: String(c.routingOrder ?? signers.length + i + 1),
    }));

    const envelope = {
      emailSubject: params.subject,
      emailBlurb: params.message || "",
      documents,
      recipients: {
        signers,
        carbonCopies: carbonCopies.length > 0 ? carbonCopies : undefined,
      },
      status: params.status || "created",
    };

    return this.request<EnvelopeSummary>("/envelopes", {
      method: "POST",
      body: envelope,
    });
  }

  async getEnvelope(envelopeId: string): Promise<unknown> {
    return this.request(`/envelopes/${envelopeId}`);
  }

  async listEnvelopes(opts: {
    fromDate?: string;
    status?: string;
    count?: number;
  } = {}): Promise<unknown> {
    const qp = new URLSearchParams();
    if (opts.fromDate) qp.set("from_date", opts.fromDate);
    if (opts.status) qp.set("status", opts.status);
    if (opts.count) qp.set("count", String(opts.count));
    const qs = qp.toString();
    return this.request(`/envelopes${qs ? `?${qs}` : ""}`);
  }

  async voidEnvelope(envelopeId: string, reason: string): Promise<unknown> {
    return this.request(`/envelopes/${envelopeId}`, {
      method: "PUT",
      body: { status: "voided", voidedReason: reason },
    });
  }

  async downloadDocument(
    envelopeId: string,
    documentId: string
  ): Promise<Buffer> {
    await this.authenticate();
    const url = `${this.apiBase}/envelopes/${envelopeId}/documents/${documentId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Download failed (${res.status}): ${text}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // ─── User info ─────────────────────────────────────────────────────

  async getUserInfo(): Promise<unknown> {
    await this.authenticate();
    const res = await fetch("https://account-d.docusign.com/oauth/userinfo", {
      headers: { Authorization: `Bearer ${this.token.accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`UserInfo failed (${res.status}): ${text}`);
    }
    return res.json();
  }
}
