import type {
  AuditEventListResponse,
  AuditEventView,
  HalfPackageApprovalListResponse,
  HalfPackageApprovalSummary,
  HalfPackageCostMargin,
  HalfPackageCostMarginResponse,
  HalfPackageQuotation,
  HalfPackageQuotationResponse,
  HalfPackageQuotationVersionSummary,
  HalfPackageQuotationVersionsResponse,
  HalfPackageSubmissionCheck,
  HalfPackageSubmissionCheckResponse,
  LoginResponse,
  MainMaterialQuotationResponse,
  MainMaterialQuotationView,
  PublishedMainMaterialCatalogResponse,
  PublishedMainMaterialCatalogView,
  PublishedHalfPackageCatalogResponse,
  PublishedHalfPackageCatalogView,
  ProjectDetail,
  ProjectSummary,
  UserSummary,
} from "@shanyu/contracts";

import { serverApiUrl as apiUrl } from "./server-api-url";

export async function fetchSession(
  cookieHeader: string,
): Promise<LoginResponse | null> {
  const response = await fetch(`${apiUrl}/auth/session`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }
  return (await response.json()) as LoginResponse;
}

export async function fetchUsers(
  cookieHeader: string,
): Promise<UserSummary[] | null> {
  const response = await fetch(`${apiUrl}/users`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Users request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { users: UserSummary[] };
  return payload.users;
}

export async function fetchProjects(
  cookieHeader: string,
): Promise<ProjectSummary[] | null> {
  const response = await fetch(`${apiUrl}/projects`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Projects request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { projects: ProjectSummary[] };
  return payload.projects;
}

export async function fetchProject(
  cookieHeader: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const response = await fetch(`${apiUrl}/projects/${projectId}`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Project request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { project: ProjectDetail };
  return payload.project;
}

export async function fetchPublishedCatalog(
  cookieHeader: string,
): Promise<PublishedHalfPackageCatalogView | null> {
  const response = await fetch(`${apiUrl}/catalog/half-package/published`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Catalog request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as PublishedHalfPackageCatalogResponse;
  return payload.catalog;
}

export async function fetchPublishedMainMaterialCatalog(
  cookieHeader: string,
  filters: { readonly category?: string; readonly query?: string; readonly spec?: string } = {},
): Promise<PublishedMainMaterialCatalogView | null> {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.query) params.set("q", filters.query);
  if (filters.spec) params.set("spec", filters.spec);
  const response = await fetch(
    `${apiUrl}/catalog/main-materials/published?${params}`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Main material catalog request failed with status ${response.status}`);
  return ((await response.json()) as PublishedMainMaterialCatalogResponse).catalog;
}

export async function fetchMainMaterialQuotation(
  cookieHeader: string,
  projectId: string,
): Promise<MainMaterialQuotationView | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/main-material-quotation`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if ([401, 403, 404, 409].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Main material quotation request failed with status ${response.status}`);
  return ((await response.json()) as MainMaterialQuotationResponse).quotation;
}

export async function fetchMainMaterialQuotationCatalog(
  cookieHeader: string,
  projectId: string,
): Promise<PublishedMainMaterialCatalogView | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/main-material-quotation/catalog`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if ([401, 403, 404, 409].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Main material quotation catalog request failed with status ${response.status}`);
  return ((await response.json()) as PublishedMainMaterialCatalogResponse).catalog;
}

export async function fetchMainMaterialQuotationVersion(
  cookieHeader: string,
  projectId: string,
  quotationId: string,
): Promise<MainMaterialQuotationView | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/main-material-quotation/versions/${quotationId}`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`Main material quotation version failed with status ${response.status}`);
  }
  return ((await response.json()) as MainMaterialQuotationResponse).quotation;
}

export async function fetchHalfPackageQuotation(
  cookieHeader: string,
  projectId: string,
): Promise<HalfPackageQuotation | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/half-package-quotation`,
    {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    },
  );
  if (response.status === 401 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Quotation request failed with status ${response.status}`,
    );
  }
  const payload = (await response.json()) as HalfPackageQuotationResponse;
  return payload.quotation;
}

export async function fetchHalfPackageCostMargin(
  cookieHeader: string,
  projectId: string,
): Promise<HalfPackageCostMargin | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/half-package-quotation/cost-margin`,
    {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    },
  );
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Cost margin request failed with status ${response.status}`,
    );
  }
  const payload = (await response.json()) as HalfPackageCostMarginResponse;
  return payload.costMargin;
}

export async function fetchSubmissionCheck(
  cookieHeader: string,
  projectId: string,
): Promise<HalfPackageSubmissionCheck | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/half-package-quotation/submission-check`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Submission check failed with status ${response.status}`);
  return ((await response.json()) as HalfPackageSubmissionCheckResponse).check;
}

export async function fetchPendingApprovals(
  cookieHeader: string,
): Promise<readonly HalfPackageApprovalSummary[] | null> {
  const response = await fetch(`${apiUrl}/approvals/half-package`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Approvals request failed with status ${response.status}`);
  return ((await response.json()) as HalfPackageApprovalListResponse).quotations;
}

export async function fetchQuotationVersion(
  cookieHeader: string,
  quotationId: string,
): Promise<HalfPackageQuotation | null> {
  const response = await fetch(`${apiUrl}/approvals/half-package/${quotationId}`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Quotation version failed with status ${response.status}`);
  return ((await response.json()) as HalfPackageQuotationResponse).quotation;
}

export async function fetchQuotationVersionCostMargin(
  cookieHeader: string,
  quotationId: string,
): Promise<HalfPackageCostMargin | null> {
  const response = await fetch(
    `${apiUrl}/approvals/half-package/${quotationId}/cost-margin`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Version cost margin failed with status ${response.status}`);
  return ((await response.json()) as HalfPackageCostMarginResponse).costMargin;
}

export async function fetchQuotationVersions(
  cookieHeader: string,
  projectId: string,
): Promise<readonly HalfPackageQuotationVersionSummary[] | null> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions`,
    { cache: "no-store", headers: { cookie: cookieHeader } },
  );
  if (response.status === 401 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Quotation versions failed with status ${response.status}`);
  return ((await response.json()) as HalfPackageQuotationVersionsResponse).versions;
}

export async function fetchAuditEvents(
  cookieHeader: string,
  filters: { readonly action?: string; readonly result?: string } = {},
): Promise<readonly AuditEventView[] | null> {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.result) params.set("result", filters.result);
  const response = await fetch(`${apiUrl}/audit-events?${params}`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Audit request failed with status ${response.status}`);
  return ((await response.json()) as AuditEventListResponse).events;
}

export async function fetchUserAuditEvents(
  cookieHeader: string,
): Promise<readonly AuditEventView[] | null> {
  const response = await fetch(`${apiUrl}/users/audit-events`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`User audit request failed with status ${response.status}`);
  }
  return ((await response.json()) as AuditEventListResponse).events;
}
