export async function requestWorkspaceMembers({ accessToken, workspaceId, method = "GET", payload = {} }) {
  if (!accessToken || !workspaceId) throw new Error("Your login or active restaurant is missing.");
  const upperMethod = String(method).toUpperCase();
  const query = upperMethod === "GET" ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  const response = await fetch(`/api/workspace-members${query}`, {
    method: upperMethod,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(upperMethod === "GET" ? {} : { "Content-Type": "application/json" }),
    },
    ...(upperMethod === "GET" ? {} : { body: JSON.stringify({ workspaceId, ...payload }) }),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data?.error || `Staff request failed (${response.status}).`);
  return data;
}
