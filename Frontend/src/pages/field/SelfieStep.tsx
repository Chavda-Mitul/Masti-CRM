import { useEffect, useRef, useState } from 'react'
import { issueText } from '../../lib/apiErrors'
import { currentPlace, type Place } from '../../lib/place'
import { toJpeg } from '../../lib/photos'
import { timeOf } from './labels'
import { useUploadSelfie } from './queries'

/** His selfie, saved, with the place and the time the phone gave when he took it. */
export interface Selfie {
  id: string
  preview: string
  place: Place
  takenAt: string
}

/**
 * "Your selfie at the door" (docs/decisions/0015-field-staff-app.md Decision 4): the phone's front camera in the page, a
 * live picture, never one from the gallery. Capture reads the phone's location at the same moment, then saves the photo
 * straight away; Retake starts again. Without the camera or the location, it says how to allow them.
 */
export function SelfieStep({
  jobId,
  value,
  onChange,
  disabled = false,
}: {
  jobId: string
  value: Selfie | null
  onChange: (selfie: Selfie | null) => void
  disabled?: boolean
}) {
  const upload = useUploadSelfie(jobId)
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
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }))
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
      setProblem(err instanceof Error ? err.message : 'Take the selfie again.')
      return
    }
    setStream(null)
    setWorking('Getting your location…')
    let place: Place
    try {
      place = await currentPlace()
    } catch (err) {
      setWorking(null)
      setProblem(err instanceof Error ? err.message : 'Your phone couldn’t find where you are. Try again.')
      return
    }
    setWorking('Saving your selfie…')
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
        <img src={value.preview} alt="Your selfie" className="field-selfie-img" />
        <span className="field-step-hint">Place and time added · {timeOf(value.takenAt)}</span>
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
          {working ?? 'Take your selfie'}
        </button>
      )}
      {message && <span className="field-step-error">{message}</span>}
    </div>
  )
}
