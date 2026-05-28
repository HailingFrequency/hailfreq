import type { MatrixClient } from "matrix-js-sdk";

export interface UserSearchResult {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function searchUsers(
  client: MatrixClient,
  searchTerm: string,
  limit = 10,
): Promise<UserSearchResult[]> {
  if (!searchTerm.trim()) return [];
  const url = `${client.getHomeserverUrl()}/_matrix/client/v3/user_directory/search`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${client.getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search_term: searchTerm, limit }),
  });
  if (!resp.ok) return [];
  const body = (await resp.json()) as {
    results?: Array<{ user_id: string; display_name?: string; avatar_url?: string }>;
  };
  return (body.results ?? []).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name || r.user_id,
    avatarUrl: r.avatar_url ?? null,
  }));
}
