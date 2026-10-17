/** Where a phone was, as the field staff record it (golden rule 5: the place for field actions). */
export interface Place {
  lat: number
  lng: number
  /** How sure the phone is, in metres. */
  accuracy: number
}

/**
 * The phone's location now: high accuracy, waiting up to 20 seconds, never an old reading. Refused in plain words:
 * location blocked for the CRM, not found, too slow, or a browser that can't share it here (a page not on https://).
 */
export function currentPlace(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This browser can’t share your location here. Open the CRM in Chrome, on its https:// address.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked for the CRM. In Chrome, tap the icon left of the address, allow Location, then try again.'
              : err.code === err.TIMEOUT
                ? 'Your phone took too long to find where you are. Turn on GPS or step outside, then try again.'
                : 'Your phone couldn’t find where you are. Turn on location (GPS), then try again.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  })
}

/** The place in Google Maps: a plain link, no key or cost. */
export const placeLink = (place: Place) => `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
