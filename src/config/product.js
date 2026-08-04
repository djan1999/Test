// Product-shell identity shown before a restaurant workspace is selected.
// Once signed in, the workspace's restaurant_config_v1 name/subtitle win.
export const PRODUCT_NAME = String(import.meta.env.VITE_APP_NAME || "SERVICE BOARD").trim()
  || "SERVICE BOARD";
export const PRODUCT_SUBTITLE = String(
  import.meta.env.VITE_APP_SUBTITLE || "RESTAURANT OPERATIONS",
).trim() || "RESTAURANT OPERATIONS";
