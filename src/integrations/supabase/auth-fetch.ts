import { getAccessToken, getSupabase } from "./client";

let _installed = false;

/**
 * Patch window.fetch so every same-origin request (server functions, server
 * routes) automatically carries the current Supabase access token. Server-side
 * `requireSupabaseAuth` middleware reads this header.
 */
export async function installAuthFetch() {
  if (_installed || typeof window === "undefined") return;
  _installed = true;

  // Make sure the client is ready and listening for token refreshes.
  await getSupabase();

  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;
      const isSameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
      if (!isSameOrigin) return original(input, init);

      const token = await getAccessToken();
      if (!token) return original(input, init);

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("authorization")) {
        headers.set("authorization", `Bearer ${token}`);
      }
      return original(input, { ...(init ?? {}), headers });
    } catch {
      return original(input, init);
    }
  };
}
