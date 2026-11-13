/* Waffle pods' location from the site address (13 Nov 2026), as the previous form and OrderPods work it out: the site is
   found on the map (Google); inside DBM's metro outline round Sydney is Sydney, round Canberra is Canberra; anywhere else is
   long distance, ACT when nearer Canberra than Sydney, else NSW; and the driving time is Google's, one way, from OrderPods'
   warehouse (22-24 Plasser Crescent, North St Marys). */
import { loadPlaces } from './googleMaps.js';
const METRO_ZONES = { Sydney: [[-33.599, 150.7378], [-33.5913, 150.7926], [-33.6003, 150.8474], [-33.632, 150.8638], [-33.6425, 150.8912], [-33.656, 150.9515], [-33.647, 150.9789], [-33.6502, 151.0173], [-33.6714, 151.0392], [-33.6841, 151.1214], [-33.6896, 151.1872], [-33.6773, 151.231], [-33.6637, 151.2639], [-33.6705, 151.3296], [-33.7022, 151.3351], [-33.7611, 151.3214], [-33.8064, 151.3077], [-33.8427, 151.2913], [-33.9061, 151.2803], [-33.965, 151.2639], [-34.0239, 151.242], [-34.0601, 151.1981], [-34.076, 151.1269], [-34.0964, 151.0118], [-34.1009, 150.9296], [-34.1077, 150.8474], [-34.1154, 150.7707], [-34.1009, 150.7049], [-34.0782, 150.6666], [-34.0511, 150.6392], [-34.0148, 150.6419], [-33.965, 150.62], [-33.9152, 150.5981], [-33.8699, 150.5898], [-33.7929, 150.5981], [-33.7385, 150.609], [-33.6977, 150.6392], [-33.6434, 150.6666], [-33.6162, 150.7049]],
Canberra: [[-35.152, 149.1478], [-35.161, 149.1757], [-35.1945, 149.2149], [-35.2302, 149.2428], [-35.266, 149.2529], [-35.3331, 149.2512], [-35.3867, 149.2484], [-35.4582, 149.226], [-35.4895, 149.1813], [-35.4984, 149.1366], [-35.4895, 149.0919], [-35.4582, 149.0528], [-35.3956, 149.0248], [-35.342, 149.008], [-35.2884, 148.998], [-35.2213, 148.9969], [-35.19, 149.008], [-35.1677, 149.0528], [-35.1565, 149.0975]] };
const METRO_CENTRES = { Sydney: [-33.8688, 151.2093], Canberra: [-35.2809, 149.13] };
export const WP_ORIGIN = '22-24 Plasser Crescent, North St Marys NSW 2760';
function insideZone(poly, lat, lng) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j];
  if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside; } return inside; }
export function locationForPoint(lat, lng) {
  if (insideZone(METRO_ZONES.Sydney, lat, lng)) return 'Sydney'; if (insideZone(METRO_ZONES.Canberra, lat, lng)) return 'Canberra';
  const d = ([a, b]) => (a - lat) ** 2 + ((b - lng) * Math.cos((lat * Math.PI) / 180)) ** 2; return d(METRO_CENTRES.Canberra) < d(METRO_CENTRES.Sydney) ? 'ACT' : 'NSW'; }
/* { location, hours, note } for an address, or { note } when it cannot be worked out */
export async function locateSite(address) {
  const P = await loadPlaces(); const g = window.google?.maps; if (!P || !g) return { note: 'The map is not available: choose the location.' };
  if (g.importLibrary) { await g.importLibrary('geocoding'); await g.importLibrary('routes'); }
  const dest = address + ', Australia';
  const pt = await new Promise((ok) => new g.Geocoder().geocode({ address: dest, region: 'au', componentRestrictions: { country: 'AU' } }, (r, st) => ok(st === 'OK' && r && r[0] ? r[0].geometry.location.toJSON() : null)));
  if (!pt) return { note: "Couldn't find this address on the map: choose the location." };
  const location = locationForPoint(pt.lat, pt.lng);
  let note = location === 'Sydney' || location === 'Canberra' ? 'Inside the ' + location + ' metro area' : 'Outside the metro areas: ' + location + ' (long distance)';
  if (location === 'Sydney' || location === 'Canberra') return { location, note };
  const dm = await new Promise((ok) => new g.DistanceMatrixService().getDistanceMatrix({ origins: [WP_ORIGIN], destinations: [dest], travelMode: g.TravelMode.DRIVING, unitSystem: g.UnitSystem.METRIC },
    (res, st) => { const el = st === 'OK' && res?.rows?.[0]?.elements?.[0]; ok(el && el.status === 'OK' ? { km: Math.round(el.distance.value / 1000), hrs: Number((el.duration.value / 3600).toFixed(2)) } : null); }));
  if (!dm) return { location, note: note + ' · the driving time could not be measured: enter it.' };
  return { location, hours: String(dm.hrs), note: note + ' · ' + dm.km + ' km, ' + dm.hrs + ' h one way from OrderPods (Google)' };
}
