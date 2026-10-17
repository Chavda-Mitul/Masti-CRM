// Photos taken in the page: the receiver's at the office handover, the field boy's selfie at the door.

/**
 * The longest side a photo is shrunk to before it's sent (0014 Decision 6, 0015 Decision 4): enough to know a face, quick
 * to upload. Redrawing also drops what the camera wrote into the file (EXIF, a phone's own location).
 */
const MAX_SIDE = 1600

/** Draws a picture no larger than MAX_SIDE and returns it as a JPEG. */
export function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo couldn’t be made. Take it again.'))), 'image/jpeg', 0.85),
  )
}

/** A picked file, shrunk the same way. */
export async function fileToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    return await toJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
