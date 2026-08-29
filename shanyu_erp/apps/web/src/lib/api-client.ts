import type {
  HalfPackageQuotation,
  HalfPackageQuotationResponse,
  LoginResponse,
  PublishedHalfPackageCatalogResponse,
  PublishedHalfPackageCatalogView,
  ProjectDetail,
  ProjectSummary,
  UserSummary,
} from "@shanyu/contracts";

export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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
