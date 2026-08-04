export async function requestPrivacyAction({ accessToken, workspaceId, action, payload = {} }) {
  if (!accessToken || !workspaceId) throw new Error("Your login or active restaurant is missing.");
  const response = await fetch("/api/privacy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, action, ...payload }),
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data?.error || `Data-management request failed (${response.status}).`);
  return data;
}

export function downloadJsonExport(data, filename = "restaurant-data-export.json") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
