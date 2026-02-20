/**
 * API ve socket base URL.
 * Geliştirme: .env içinde VITE_API_URL tanımlanabilir (örn. http://localhost:4000)
 * Üretim: build öncesi VITE_API_URL set edilmeli.
 */
export const API_BASE_URL =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "http://localhost:4000/";
