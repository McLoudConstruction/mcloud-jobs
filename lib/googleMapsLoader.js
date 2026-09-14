// Loads the Google Maps JS API (places library) exactly once, however
// many autocomplete inputs end up on a page. Resolves to false — never
// throws — if no key is configured, so every caller can just check the
// boolean and fall back to a plain input with zero special-casing.
//
// The key itself comes from Settings → Integrations (stored encrypted,
// same as Resend/Weather/Unsplash), fetched here through
// /api/integrations/google-maps-key rather than baked in at build time —
// that's what lets it be changed from the app without a redeploy.
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is still honored as a fallback for
// anyone who set it the old way and hasn't moved it into Settings yet.
import { supabase } from './supabaseClient';

let loadPromise = null;

async function fetchConfiguredKey() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null; // no signed-in staff session (e.g. not logged in yet) — nothing to fetch with
    const res = await fetch('/api/integrations/google-maps-key', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = await res.json();
    return body.apiKey || null;
  } catch {
    return null; // network hiccup, etc. — caller falls back below, never throws
  }
}

export function loadGoogleMapsPlaces() {
  if (typeof window === 'undefined') return Promise.resolve(false);

  if (window.google?.maps?.places) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const apiKey = (await fetchConfiguredKey()) || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return false;

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false); // fail quiet — caller falls back to a plain input
      document.head.appendChild(script);
    });
  })();

  return loadPromise;
}
