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
//
// Because the key can now show up AFTER the app has already loaded (add
// it in Settings, no redeploy needed), a failed attempt must NOT be
// cached the way a successful one is — otherwise the first page load
// after adding the key still shows a plain input for the rest of that
// browser tab's life, with no way to retry short of a hard reload. Only
// a successful script load is remembered; a failure resets loadPromise
// so the next mounted autocomplete field tries again from scratch.
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

  // Specifically AutocompleteSuggestion, not just `.places` — the legacy
  // google.maps.places.Autocomplete widget this app used to check for is
  // discontinued for any account that started using Places API after
  // March 1, 2025 (Google's own console warning: "not available to new
  // customers"). AutocompleteSuggestion is the non-deprecated data API
  // PlacesAutocompleteInput now builds its own dropdown from instead.
  if (window.google?.maps?.places?.AutocompleteSuggestion) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  const thisAttempt = (async () => {
    const apiKey = (await fetchConfiguredKey()) || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      loadPromise = null; // no key yet — don't poison future attempts once one gets saved
      return false;
    }

    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        loadPromise = null; // fail quiet AND retryable — caller falls back to a plain input for now
        resolve(false);
      };
      document.head.appendChild(script);
    });
  })();
  loadPromise = thisAttempt;

  return thisAttempt;
}
