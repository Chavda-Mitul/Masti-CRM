import { useEffect, useRef, useState } from 'react'
import { errorText } from '../../../lib/apiErrors'
import { useUploadHandoverPhoto } from '../queries'

/** The longest side a photo is shrunk to before it's sent (0014 Decision 6): enough to know a face, quick to upload. */
const MAX_SIDE = 1600

/** Draws a picture no larger than MAX_SIDE and returns it as a JPEG. */
function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
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
async function fileToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    return await toJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/** A photo saved for the handover: its case file, and a local preview of it. */
export interface UploadedPhoto {
  id: string
  fileName: string
  preview: string
}

/**
 * The photo of the person collecting the passports (docs/decisions/0014-visa-delivered.md Decision 6). "Take photo"
 * opens the computer's camera in the page (a phone's or tablet's own camera there); "Upload a photo" picks a file
 * instead. Either is shrunk to at most 1600 px and uploaded straight away; "Retake" starts again. Without a camera
 * (blocked, missing, or a page not on HTTPS) the upload still works.
 */
export function PhotoCapture({
  caseNo,
  value,
  onChange,
  disabled = false,
}: {
  caseNo: string
  value: UploadedPhoto | null
  onChange: (photo: UploadedPhoto | null) => void
  disabled?: boolean
}) {
  const upload = useUploadHandoverPhoto(caseNo)
  const video = useRef<HTMLVideoElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const hasCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  // The camera is switched off once a photo is taken, cancelled, or the dialog closes.
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream])
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream])

  const send = (blob: Blob) => {
    setProblem(null)
    const preview = URL.createObjectURL(blob)
    upload.mutate(blob, {
      onSuccess: (photo) => onChange({ ...photo, preview }),
      onError: () => URL.revokeObjectURL(preview),
    })
  }
  const start = async () => {
    setProblem(null)
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }))
    } catch {
      setProblem('The camera is blocked or missing. Upload a photo instead.')
    }
  }
  const capture = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    try {
      const blob = await toJpeg(v, v.videoWidth, v.videoHeight)
      setStream(null)
      send(blob)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Take the photo again.')
    }
  }
  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      send(await fileToJpeg(file))
    } catch {
      setProblem(`${file.name} can’t be read as a photo. Pick a JPEG or PNG.`)
    }
  }
  const message = problem ?? errorText(upload.error)

  if (value) {
    return (
      <div className="photo-capture">
        <img src={value.preview} alt="The person collecting the passports" className="photo-preview" />
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled}
          onClick={() => {
            URL.revokeObjectURL(value.preview)
            onChange(null)
          }}
        >
          Retake
        </button>
      </div>
    )
  }
  return (
    <div className="photo-capture">
      {stream ? (
        <>
          <video ref={video} className="photo-preview" autoPlay playsInline muted aria-label="Camera" />
          <span className="photo-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void capture()}>
              Capture
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setStream(null)}>
              Cancel
            </button>
          </span>
        </>
      ) : (
        <span className="photo-actions">
          {hasCamera && (
            <button type="button" className="btn btn-sm" disabled={disabled || upload.isPending} onClick={() => void start()}>
              Take photo
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={disabled || upload.isPending} onClick={() => input.current?.click()}>
            Upload a photo
          </button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            capture="user"
            hidden
            aria-label="Photo of the person collecting"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </span>
      )}
      {upload.isPending && <span className="muted small">Saving the photo…</span>}
      {message && <span className="field-error">{message}</span>}
    </div>
  )
}
