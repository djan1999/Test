async function readJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export async function requestManagedRestaurants({ accessToken, method = "GET", payload } = {}) {
  if (!accessToken) throw new Error("Sign in before opening restaurant onboarding.");
  const upperMethod = String(method).toUpperCase();
  const response = await fetch("/api/restaurants", {
    method: upperMethod,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(upperMethod === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(upperMethod === "POST" ? { body: JSON.stringify(payload || {}) } : {}),
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Restaurant onboarding failed (${response.status}).`);
    error.status = response.status;
    error.fields = data?.fields || {};
    throw error;
  }
  return data;
}
