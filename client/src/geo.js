/** One-shot GPS reading with accuracy. Rejects with a friendly message. */
export function getPosition({ timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device does not support location.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, gps_accuracy_m: Math.max(1, Math.round(p.coords.accuracy)) }),
      err => reject(new Error(
        err.code === 1 ? 'Location permission was denied. Allow location access for this app and try again.'
          : err.code === 3 ? 'Could not get a GPS fix in time. Move to an open area and try again.'
          : 'Could not read your location. Turn on GPS and try again.')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}
