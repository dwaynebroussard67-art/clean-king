// Future production helper. Call only after server-side authorization of the assigned shift.
// Construct a fixed-origin Google Maps URL rather than accepting a user-provided URL.
export function directionsUrl(address) {
  if (typeof address !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(address)) return null;
  const destination = address.trim();
  if (!destination || destination.length > 400) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  url.searchParams.set('travelmode', 'driving');
  const result = url.toString();
  return result.length <= 2048 ? result : null;
}
