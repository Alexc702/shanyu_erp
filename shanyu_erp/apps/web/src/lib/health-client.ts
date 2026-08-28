import type { HealthResponse } from "@shanyu/contracts";

const DEFAULT_API_URL = "http://localhost:3001";

export async function fetchHealth(
  fetcher: typeof fetch = fetch,
  apiUrl = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL,
): Promise<HealthResponse> {
  const response = await fetcher(`${apiUrl}/health`);

  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}
