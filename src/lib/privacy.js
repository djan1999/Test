async function privacyRequest({ accessToken, workspaceId, action, payload = {} }) {
  if (!accessToken || !workspaceId) throw new Error("Your login or active restaurant is missing.");
  return fetch("/api/privacy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, action, ...payload }),
  });
}

export async function requestPrivacyAction(options) {
  const response = await privacyRequest(options);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data?.error || `Data-management request failed (${response.status}).`);
  return data;
}

export async function downloadPrivacyExport({ accessToken, workspaceId }) {
  const response = await privacyRequest({ accessToken, workspaceId, action: "export" });
  if (!response.ok) {
    let data;
    try { data = await response.json(); } catch { data = {}; }
    throw new Error(data?.error || `Data-management request failed (${response.status}).`);
  }
  const disposition = String(response.headers.get("content-disposition") || "");
  const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || "restaurant-data-export.json";
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { filename };
}
