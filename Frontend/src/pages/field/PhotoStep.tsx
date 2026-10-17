import { useEffect, useRef, useState } from 'react'
import { issueText } from '../../lib/apiErrors'
import { currentPlace, type Place } from '../../lib/place'
import { toJpeg } from '../../lib/photos'
import { timeOf } from './labels'
import { useUploadDoorPhoto, type DoorPhoto } from './queries'

/** A photo taken at the door, saved: its case file, a preview, when it was taken, and (for his selfie) the place. */
export interface TakenPhoto {
  id: string
  preview: string
  takenAt: string
  place: Place | null
}

const WORDING: Record<DoorPhoto, { camera: 'user' | 'environment'; take: string; alt: string; saving: string }> = {
  selfie: { camera: 'user', take: 'Take your selfie', alt: 'Your selfie', saving: 'Saving your selfie…' },
  receiver: { camera: 'environment', take: 'Take their photo', alt: 'The person receiving', saving: 'Saving the photo…' },
}

/**
 * A photo at the client's door (docs/decisions/0015-field-staff-app.md Decision 4), taken in the page, live, never from
 * the gallery: his selfie with the front camera, its place and time read from the phone at the same moment; or, at a
 * delivery, the person receiving with the back camera. Saved straight away; Retake starts again. Without the camera or
 * the location, it says how to allow them.
 */
export function PhotoStep({
  jobId,
  kind,
  value,
  onChange,
  disabled = false,
}: {
  jobId: string
  kind: DoorPhoto
  value: TakenPhoto | null
  onChange: (photo: TakenPhoto | null) => void
  disabled?: boolean
}) {
  const words = WORDING[kind]
  const upload = useUploadDoorPhoto(jobId, kind)
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  // Capture waits for the first frames: before them a picture would come out black.
  const [live, setLive] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // The camera is switched off once a picture is taken, cancelled, or he leaves the stop.
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream])
  useEffect(() => {
    const v = video.current
    if (!v || !stream) return
    v.srcObject = stream
    // autoPlay alone doesn't start a camera stream everywhere (iOS Safari, a headless browser): ask for it.
    void v.play().catch(() => undefined)
  }, [stream])

  const start = async () => {
    setProblem(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem('This browser can’t open the camera here. Open the CRM in Chrome, on its https:// address.')
      return
    }
    try {
      setLive(false)
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: words.camera }, audio: false }))
    } catch {
      setProblem('The camera is blocked for the CRM. In Chrome, tap the icon left of the address, allow Camera, then try again.')
    }
  }

  const capture = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    let photo: Blob
    try {
      photo = await toJpeg(v, v.videoWidth, v.videoHeight)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Take the photo again.')
      return
    }
    setStream(null)
    let place: Place | null = null
    if (kind === 'selfie') {
      setWorking('Getting your location…')
      try {
        place = await currentPlace()
      } catch (err) {
        setWorking(null)
        setProblem(err instanceof Error ? err.message : 'Your phone couldn’t find where you are. Try again.')
        return
      }
    }
    setWorking(words.saving)
    const preview = URL.createObjectURL(photo)
    upload.mutate(photo, {
      onSuccess: (file) => onChange({ id: file.id, preview, place, takenAt: new Date().toISOString() }),
      onError: () => URL.revokeObjectURL(preview),
      onSettled: () => setWorking(null),
    })
  }

  const message = problem ?? issueText(upload.error)

  if (value) {
    return (
      <div className="field-selfie">
        <img src={value.preview} alt={words.alt} className="field-selfie-img" />
        <span className="field-step-hint">
          {kind === 'selfie' ? 'Place and time added' : 'Taken'} · {timeOf(value.takenAt)}
        </span>
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
    <div className="field-selfie">
      {stream ? (
        <>
          <video ref={video} className="field-selfie-img" autoPlay playsInline muted aria-label="Camera" onPlaying={() => setLive(true)} />
          <div className="field-selfie-actions">
            <button type="button" className="btn btn-primary" onClick={() => void capture()} disabled={!live}>
              {live ? 'Capture' : 'Starting the camera…'}
            </button>
            <button type="button" className="btn" onClick={() => setStream(null)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn field-step-action" disabled={disabled || working !== null} onClick={() => void start()}>
          {working ?? words.take}
        </button>
      )}
      {message && <span className="field-step-error">{message}</span>}
    </div>
  )
}
