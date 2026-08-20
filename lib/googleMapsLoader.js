// Loads the Google Maps JS API (places library) exactly once, however
// many autocomplete inputs end up on a page. Resolves to false — never
// throws — if no API key is configured, so every caller can just check
// the boolean and fall back to a plain input with zero special-casing.
let loadPromise = null;

export function loadGoogleMapsPlaces() {
  if (typeof window === 'undefined') return Promise.resolve(false);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.resolve(false);

  if (window.google?.maps?.places) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false); // fail quiet — caller falls back to a plain input
    document.head.appendChild(script);
  });

  return loadPromise;
}
