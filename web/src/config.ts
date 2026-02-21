export const API_BASE_URL =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "http://localhost:4000";
