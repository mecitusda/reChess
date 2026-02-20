export const AUTH_TOKEN_KEY = "authToken";
export const GUEST_ID_KEY = "guestId";
export const GUEST_NAME_KEY = "guestName";
export const AUTH_CHANGED_EVENT = "auth:changed";

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function getOrCreateGuestId() {
  const existing = localStorage.getItem(GUEST_ID_KEY);
  if (existing) return existing;
  const id =
    (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
      .replace(/-/g, "")
      .slice(0, 24);
  localStorage.setItem(GUEST_ID_KEY, id);
  return id;
}

export function getOrCreateGuestName() {
  const existing = localStorage.getItem(GUEST_NAME_KEY);
  if (existing) return existing;
  const adjectives = ["Swift", "Calm", "Brave", "Clever", "Bold", "Lucky", "Silent", "Fierce"];
  const pieces = ["Knight", "Bishop", "Rook", "Queen", "King", "Pawn"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const pc = pieces[Math.floor(Math.random() * pieces.length)];
  const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
  const name = `Guest_${adj}${pc}_${suffix}`;
  localStorage.setItem(GUEST_NAME_KEY, name);
  return name;
}

