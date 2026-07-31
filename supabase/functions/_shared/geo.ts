/** Shared geo helpers for Edge Functions */

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isCanadianCoordinate(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= 41.5 && lat <= 83.5 && lng >= -141.1 && lng <= -52.5;
}

export function roundCoord(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(Number(n) * f) / f;
}
