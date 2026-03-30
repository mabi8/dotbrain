import { BASE_URL, ZohoConfig } from "./config.js";
import { getAccessToken } from "./auth.js";

async function request(
  config: ZohoConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<any> {
  const token = await getAccessToken(config);
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();

  if (!res.ok && res.status !== 400) {
    throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

// === Accounts ===

export async function listAccounts(config: ZohoConfig): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/accounts`);
}

export async function getAccount(config: ZohoConfig, idOrEmail: string): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/accounts/${idOrEmail}`);
}

export async function addAccount(
  config: ZohoConfig,
  opts: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    displayName?: string;
    role?: string;
    country?: string;
    timeZone?: string;
  }
): Promise<any> {
  return request(config, "POST", `/api/organization/${config.zoid}/accounts`, {
    primaryEmailAddress: opts.email,
    password: opts.password,
    firstName: opts.firstName,
    lastName: opts.lastName,
    displayName: opts.displayName || opts.firstName,
    role: opts.role || "member",
    country: opts.country || "de",
    timeZone: opts.timeZone || "Europe/Berlin",
  });
}

export async function deleteAccount(config: ZohoConfig, zuid: string): Promise<any> {
  return request(config, "DELETE", `/api/organization/${config.zoid}/accounts`, {
    zuid,
  });
}

export async function updateAccountStatus(
  config: ZohoConfig,
  accountId: string,
  enabled: boolean
): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/accounts/${accountId}`, {
    mode: enabled ? "enableUser" : "disableUser",
  });
}

// === Domains ===

export async function listDomains(config: ZohoConfig): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/domains`);
}

export async function getDomain(config: ZohoConfig, domain: string): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/domains/${domain}`);
}

export async function addDomain(config: ZohoConfig, domainName: string): Promise<any> {
  return request(config, "POST", `/api/organization/${config.zoid}/domains`, {
    domainName,
  });
}

export async function verifyDomain(
  config: ZohoConfig,
  domain: string,
  method: "txt" | "cname" | "html" = "txt"
): Promise<any> {
  const modeMap = {
    txt: "verifyDomainByTXT",
    cname: "verifyDomainByCName",
    html: "verifyDomainByHTML",
  };
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: modeMap[method],
  });
}

export async function enableMailHosting(config: ZohoConfig, domain: string): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: "enableMailHosting",
  });
}

export async function verifyMx(config: ZohoConfig, domain: string): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: "verifyMxRecord",
  });
}

export async function verifySPF(config: ZohoConfig, domain: string): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: "verifySPF",
  });
}

export async function addDkim(config: ZohoConfig, domain: string, selector: string = "zoho"): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: "addDkimDetail",
    selector,
    isDefault: true,
    keySize: 1024,
  });
}

export async function verifyDkim(config: ZohoConfig, domain: string, dkimId: string): Promise<any> {
  return request(config, "PUT", `/api/organization/${config.zoid}/domains/${domain}`, {
    mode: "verifyDkimKey",
    dkimId,
  });
}

export async function deleteDomain(config: ZohoConfig, domain: string): Promise<any> {
  return request(config, "DELETE", `/api/organization/${config.zoid}/domains/${domain}`);
}

// === Groups ===

export async function listGroups(config: ZohoConfig): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/groups`);
}

export async function getGroup(config: ZohoConfig, zgid: string): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/groups/${zgid}`);
}

export async function createGroup(
  config: ZohoConfig,
  opts: {
    emailId: string;
    name: string;
    description?: string;
    members?: { email: string; role: string }[];
  }
): Promise<any> {
  return request(config, "POST", `/api/organization/${config.zoid}/groups`, {
    emailId: opts.emailId,
    name: opts.name,
    groupDescription: opts.description,
    mailGroupMemberList: opts.members?.map((m) => ({
      memberEmailId: m.email,
      role: m.role,
    })),
  });
}

export async function deleteGroup(config: ZohoConfig, zgid: string): Promise<any> {
  return request(config, "DELETE", `/api/organization/${config.zoid}/groups/${zgid}`);
}

// === Organization ===

export async function getOrg(config: ZohoConfig): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}`);
}

export async function getStorage(config: ZohoConfig): Promise<any> {
  return request(config, "GET", `/api/organization/${config.zoid}/storage`);
}
