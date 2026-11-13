import { useEffect, useRef, useState } from 'react';
import { loadPlaces, mapsProblem, setMapsProblem } from '../lib/googleMaps.js';

/* An address box with Google's suggestions, Australia only (13 Nov 2026), as the previous form: type a few letters, pick
   one, and it fills the street and the suburb with state and postcode. Uses Google's newer suggestions when the key has
   them, else the older ones. Without a key it is a plain box. */
function parts(comps, formatted) {
  const get = (t, short) => { const c = (comps || []).find((x) => (x.types || []).includes(t)); return c ? (short ? c.shortText ?? c.short_name : c.longText ?? c.long_name) : ''; };
  const street = [get('subpremise') && get('subpremise') + '/', get('street_number'), get('route', true) || get('route')].filter(Boolean).join(' ').replace('/ ', '/');
  const suburb = [get('locality') || get('sublocality') || get('postal_town'), get('administrative_area_level_1', true), get('postal_code')].filter(Boolean).join(' ');
  return { street: street || String(formatted || '').split(',')[0], suburb, full: [street, suburb].filter(Boolean).join(', ') || formatted || '' };
}

export default function AddressInput({ value, onChange, onPick, placeholder, ariaLabel, className }) {
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const places = useRef(null), token = useRef(null), typed = useRef(false);
  const [problem, setProblem] = useState(mapsProblem);
  useEffect(() => { const f = () => setProblem(mapsProblem); window.addEventListener('dbm-maps-problem', f); return () => window.removeEventListener('dbm-maps-problem', f); }, []);
  useEffect(() => { loadPlaces().then((p) => { places.current = p; }); }, []);
  useEffect(() => {
    const t = String(value || '').trim(); if (!typed.current || t.length < 3) { setHits([]); return; }
    const h = setTimeout(async () => {
      const P = places.current || await loadPlaces(); places.current = P; if (!P) return;
      try {
        if (P.AutocompleteSuggestion) {   /* the newer suggestions */
          token.current = token.current || new P.AutocompleteSessionToken();
          const { suggestions } = await P.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: t, includedRegionCodes: ['au'], sessionToken: token.current });
          setHits((suggestions || []).filter((x) => x.placePrediction).slice(0, 6).map((x) => ({ text: x.placePrediction.text.toString(), pick: async () => { const pl = x.placePrediction.toPlace(); await pl.fetchFields({ fields: ['addressComponents', 'formattedAddress'] }); token.current = null; return parts(pl.addressComponents, pl.formattedAddress); } })));
        } else {                           /* the older suggestions */
          const svc = new P.AutocompleteService();
          svc.getPlacePredictions({ input: t, componentRestrictions: { country: 'au' }, types: ['address'] }, (res, st) => {
            if (st && st !== 'OK' && st !== 'ZERO_RESULTS') setMapsProblem('Google suggestions: ' + st);
            setHits((res || []).slice(0, 6).map((r) => ({ text: r.description, pick: () => new Promise((ok) => {
              new P.PlacesService(document.createElement('div')).getDetails({ placeId: r.place_id, fields: ['address_components', 'formatted_address'] }, (d) => ok(d ? parts(d.address_components, d.formatted_address) : { street: r.description.split(',')[0], suburb: '', full: r.description })); }) })));
          });
        }
        setOpen(true); setAct(-1);
      } catch (e) { setHits([]); setMapsProblem('Google suggestions: ' + String(e?.message || e).slice(0, 220)); }
    }, 250);
    return () => clearTimeout(h);
  }, [value]);
  const choose = async (x) => { setOpen(false); setHits([]); typed.current = false; const r = await x.pick(); onPick && onPick(r); };
  return (
    <span className="ad-wrap">
      <input className={className} value={value} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off"
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => hits.length && setOpen(true)}
        onKeyDown={(e) => { if (!open || !hits.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(hits.length - 1, a + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(0, a - 1)); } else if (e.key === 'Enter' && act >= 0) { e.preventDefault(); choose(hits[act]); } else if (e.key === 'Escape') setOpen(false); }} />
      {problem && typed.current && String(value || '').trim().length >= 3 && <small className="ad-prob">{problem}</small>}
      {open && hits.length > 0 && <span className="ad-pop" role="listbox">{hits.map((x, i) => <button key={x.text + i} type="button" role="option" aria-selected={i === act} className={i === act ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(x)}>{x.text}</button>)}<small>Suggestions by Google</small></span>}
    </span>
  );
}
