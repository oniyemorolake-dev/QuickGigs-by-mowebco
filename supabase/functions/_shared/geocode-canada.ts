import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isCanadianCoordinate, roundCoord } from './geo.ts';

export type GeocodeResult = {
  lookup_key: string;
  postal_code: string | null;
  city: string;
  province: string;
  lat: number;
  lng: number;
  location: string;
  cached: boolean;
};

const PROVINCE_MAP: Record<string, string> = {
  Alberta: 'AB',
  'British Columbia': 'BC',
  Manitoba: 'MB',
  'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL',
  'Nova Scotia': 'NS',
  Ontario: 'ON',
  'Prince Edward Island': 'PE',
  Quebec: 'QC',
  Saskatchewan: 'SK',
  'Northwest Territories': 'NT',
  Nunavut: 'NU',
  Yukon: 'YT',
};

const PROVINCE_NAMES = Object.keys(PROVINCE_MAP);

function normalizeProvince(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[A-Z]{2}$/.test(s)) return s;
  const code = s.replace(/^CA-/i, '');
  if (/^[A-Z]{2}$/.test(code)) return code.toUpperCase();
  return PROVINCE_MAP[s] || PROVINCE_MAP[s.replace(/\s+/g, ' ')] || s.slice(0, 2).toUpperCase();
}

function formatLocation(city: string, province: string): string {
  const c = String(city || '').trim();
  const p = normalizeProvince(province);
  return c ? (p ? `${c}, ${p}` : c) : '';
}

/** Stable cache key for postal codes vs free-text places. */
export function normalizeLookupKey(query: string): string {
  const q = String(query || '').trim();
  if (!q) return '';
  const compact = q.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return `postal:${compact}`;
  return `place:${q.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function parseCityProvinceFromText(query: string): { city: string; province: string } {
  const parts = String(query || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts[0],
      province: normalizeProvince(parts[parts.length - 1]),
    };
  }
  return { city: parts[0] || String(query || '').trim(), province: '' };
}

function rowFromAddress(address: Record<string, string>, fallbackQuery: string) {
  const city =
    address.city ||
    address.town ||
    address.municipality ||
    address.village ||
    address.hamlet ||
    parseCityProvinceFromText(fallbackQuery).city;
  const province = normalizeProvince(
    address['ISO3166-2-lvl4']?.replace(/^CA-/i, '') ||
      address.state_code ||
      address.state ||
      parseCityProvinceFromText(fallbackQuery).province,
  );
  return { city, province };
}

async function fetchFromMapbox(query: string): Promise<Omit<GeocodeResult, 'lookup_key' | 'cached'> | null> {
  const token = Deno.env.get('MAPBOX_ACCESS_TOKEN') || Deno.env.get('GEOCODE_API_KEY') || '';
  if (!token) return null;

  const isPostal = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(String(query).trim());
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  );
  url.searchParams.set('access_token', token);
  url.searchParams.set('country', 'ca');
  url.searchParams.set('limit', '1');
  if (isPostal) url.searchParams.set('types', 'postcode');

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      features?: Array<{
        center?: [number, number];
        context?: Array<{ id?: string; short_code?: string; text?: string }>;
        text?: string;
        place_type?: string[];
      }>;
    };
    const feature = data.features?.[0];
    if (!feature?.center || feature.center.length < 2) return null;
    const lng = Number(feature.center[0]);
    const lat = Number(feature.center[1]);
    if (!isCanadianCoordinate(lat, lng)) return null;

    let province = '';
    let city = feature.text || '';
    for (const ctx of feature.context || []) {
      const id = String(ctx.id || '');
      if (id.startsWith('region')) {
        province = normalizeProvince(ctx.short_code?.replace(/^ca-/i, '') || ctx.text || '');
      }
      if (id.startsWith('place.') && !city) city = ctx.text || city;
    }
    if (!city) {
      const parsed = parseCityProvinceFromText(query);
      city = parsed.city;
      province = province || parsed.province;
    }

    const postalMatch = String(query).replace(/\s+/g, '').toUpperCase();
    const postal = /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalMatch) ? postalMatch : null;
    return {
      postal_code: postal,
      city,
      province,
      lat: roundCoord(lat, 2),
      lng: roundCoord(lng, 2),
      location: formatLocation(city, province),
    };
  } catch {
    return null;
  }
}

async function fetchFromNominatim(query: string): Promise<Omit<GeocodeResult, 'lookup_key' | 'cached'> | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ca');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-CA,en',
        'User-Agent': 'QuickGigs/1.0 (https://quickgigs.ca)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ lat?: string; lon?: string; address?: Record<string, string> }>;
    const row = rows?.[0];
    if (!row) return null;
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!isCanadianCoordinate(lat, lng)) return null;
    const { city, province } = rowFromAddress(row.address || {}, query);
    const postalMatch = String(query).replace(/\s+/g, '').toUpperCase();
    const postal = /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalMatch) ? postalMatch : null;
    return {
      postal_code: postal,
      city,
      province,
      lat: roundCoord(lat, 2),
      lng: roundCoord(lng, 2),
      location: formatLocation(city, province),
    };
  } catch {
    return null;
  }
}

export async function lookupGeocodeCache(
  supabase: SupabaseClient,
  lookupKey: string,
): Promise<GeocodeResult | null> {
  if (!lookupKey) return null;
  const { data, error } = await supabase
    .from('geocode_cache')
    .select('lookup_key,postal_code,city,province,lat,lng')
    .eq('lookup_key', lookupKey)
    .maybeSingle();
  if (error || !data) return null;
  return {
    lookup_key: data.lookup_key,
    postal_code: data.postal_code,
    city: data.city,
    province: data.province,
    lat: Number(data.lat),
    lng: Number(data.lng),
    location: formatLocation(data.city, data.province),
    cached: true,
  };
}

export async function geocodeCanada(
  supabase: SupabaseClient,
  query: string,
): Promise<GeocodeResult | null> {
  const q = String(query || '').trim();
  if (!q) return null;
  const lookupKey = normalizeLookupKey(q);
  if (!lookupKey) return null;

  const cached = await lookupGeocodeCache(supabase, lookupKey);
  if (cached) return cached;

  let hit = await fetchFromMapbox(q);
  if (!hit) hit = await fetchFromNominatim(q);
  if (!hit || !hit.city) return null;

  const row = {
    lookup_key: lookupKey,
    postal_code: hit.postal_code,
    city: hit.city,
    province: hit.province || parseCityProvinceFromText(q).province,
    lat: hit.lat,
    lng: hit.lng,
  };

  const { error } = await supabase.from('geocode_cache').upsert(row, { onConflict: 'lookup_key' });
  if (error) console.warn('geocode_cache upsert failed:', error.message);

  return {
    ...row,
    location: formatLocation(row.city, row.province),
    cached: false,
  };
}

/** Major metro centers — used for smart default browse radius hints. */
export const MAJOR_METRO_CENTERS: Array<{ lat: number; lng: number }> = [
  { lat: 43.653, lng: -79.383 }, // Toronto
  { lat: 45.501, lng: -73.567 }, // Montreal
  { lat: 49.283, lng: -123.121 }, // Vancouver
  { lat: 51.044, lng: -114.072 }, // Calgary
  { lat: 53.546, lng: -113.494 }, // Edmonton
  { lat: 45.421, lng: -75.697 }, // Ottawa
  { lat: 43.589, lng: -79.644 }, // Mississauga
  { lat: 49.895, lng: -97.138 }, // Winnipeg
  { lat: 44.648, lng: -63.575 }, // Halifax
  { lat: 46.813, lng: -71.208 }, // Quebec City
];

export function isNearMajorMetro(lat: number, lng: number, thresholdKm = 35): boolean {
  for (const center of MAJOR_METRO_CENTERS) {
    const dLat = (center.lat - lat) * Math.PI / 180;
    const dLng = (center.lng - lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat * Math.PI / 180) * Math.cos(center.lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (km <= thresholdKm) return true;
  }
  return false;
}

export { PROVINCE_MAP, PROVINCE_NAMES, formatLocation, normalizeProvince };
