/* Google Maps' places (13 Nov 2026), with the previous portal's key: VITE_GOOGLE_MAPS_KEY in .env (and Netlify).
   Loaded once, on first use; resolves to google.maps.places, or null when there is no key or it will not load. */
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
let loading = null;
/* why the suggestions are not working, shown under the box (no key, the key refused, the script blocked) */
export let mapsProblem = KEY ? '' : 'No Google key in .env (VITE_GOOGLE_MAPS_KEY): restart npm run dev after adding it.';
if (typeof window !== 'undefined') window.gm_authFailure = () => { mapsProblem = 'Google refused the key here: add this address (' + window.location.origin + '/*) to the key\'s website restrictions, and turn on the Places API.'; window.dispatchEvent(new Event('dbm-maps-problem')); };
export const setMapsProblem = (t) => { mapsProblem = t; window.dispatchEvent(new Event('dbm-maps-problem')); };
export function loadPlaces() {
  if (!KEY) return Promise.resolve(null);
  if (window.google?.maps?.places) return Promise.resolve(window.google.maps.places);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const cb = '__dbmMapsReady';
    window[cb] = async () => { try { const places = window.google.maps.importLibrary ? await window.google.maps.importLibrary('places') : window.google.maps.places; resolve(places || null); } catch { resolve(null); } };
    const s = document.createElement('script');
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(KEY) + '&libraries=places&loading=async&callback=' + cb;
    s.async = true; s.onerror = () => { setMapsProblem('Google Maps could not be loaded (blocked or offline).'); resolve(null); };
    document.head.appendChild(s);
  });
  return loading;
}
export const mapsReady = Boolean(KEY);
