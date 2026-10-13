import { useRef } from 'react'
import { Link } from 'react-router'
import { canActOnCase, canEditVisaMasters } from '../../../auth/permissions'
import { useMe } from '../../../auth/useAuth'
import { errorBody, errorText } from '../../../lib/apiErrors'
import { formatDateTime, formatMobile } from '../../../lib/format'
import { useToast } from '../../../lib/toast'
import { useMasterList } from '../../settings/masters/queries'
import { useOpenCaseFile, useSetVendor, useUploadFinalFile } from '../queries'
import type { CaseVendor, VisaCase } from '../types'

const MB = 1024 * 1024

/** "12.4 MB", "820 KB" */
function fileSize(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

/**
 * "Saved file — kept as proof" (demo screen 08 ⚠️, docs/decisions/0007-visa-file-prep.md Decision 8): the whole file as
 * it went to the vendor, one PDF, in the private document store. The processor, the HOD or the Head uploads it during
 * File preparation; a newer upload becomes the current one and older ones are kept. Anyone who can open the case can
 * open the file, through a link that works for a few minutes. The vendor it goes to is picked at the bottom, as in the
 * demo.
 */
export function SavedFileCard({ visaCase: c }: { visaCase: VisaCase }) {
  const { data: me } = useMe()
  const toast = useToast()
  const upload = useUploadFinalFile(c.caseNo)
  const open = useOpenCaseFile(c.caseNo)
  const input = useRef<HTMLInputElement>(null)
  if (!c.maturedAt) return null

  const editable =
    !!me && c.status === 'OPEN' && c.stage.code === 'FILE_PREPARATION' && canActOnCase(me, { department: c.department.code, owner: c.owner })
  const file = c.finalFile
  const older = c.finalFileCopies - 1

  const send = (picked: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again still triggers a change
    if (!picked) return
    if (!isPdf(picked)) {
      toast({ tone: 'bad', message: `${picked.name} isn’t a PDF. Save the scan as a PDF and upload that.` })
      return
    }
    if (picked.size > c.finalFileMaxMb * MB) {
      toast({ tone: 'bad', message: `${picked.name} is ${fileSize(picked.size)}: the limit is ${c.finalFileMaxMb} MB. Scan it at a lower resolution.` })
      return
    }
    upload.mutate(
      { file: picked },
      {
        onSuccess: () => toast({ tone: 'ok', message: file ? 'New copy saved. The earlier one is kept.' : 'File saved.' }),
        onError: (err) => toast({ tone: 'bad', message: errorText(err) ?? 'Couldn’t upload the file. Please try again.' }),
      },
    )
  }

  return (
    <section className="card pad saved-file">
      <h2 className="h2">Saved file — kept as proof</h2>
      {file ? (
        <>
          <div className="kv">
            <span className="mono saved-file-name">{file.fileName}</span>
            <strong>
              {file.pageCount} {file.pageCount === 1 ? 'page' : 'pages'}
            </strong>
          </div>
          <p className="muted small saved-file-meta">
            {fileSize(file.sizeBytes)} · uploaded by {file.uploadedBy.name}, {formatDateTime(file.uploadedAt)}
            {older > 0 && ` · ${older} earlier ${older === 1 ? 'copy' : 'copies'} kept`}
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            Every page as it went to the vendor, stored privately. Open gives a link that works for a few minutes.
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {editable
            ? 'Scan the whole file as one PDF, every page as it goes to the vendor, and upload it here. It is stored privately.'
            : 'No file uploaded yet.'}
        </p>
      )}

      <div className="saved-file-actions">
        {file && (
          <button type="button" className="btn btn-sm" onClick={() => open(file.id)}>
            Open
          </button>
        )}
        {editable && (
          <>
            <button type="button" className={`btn btn-sm${file ? '' : ' btn-primary'}`} disabled={upload.isPending} onClick={() => input.current?.click()}>
              {upload.isPending ? 'Uploading…' : file ? 'Replace' : 'Upload PDF'}
            </button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              aria-label="PDF of the final file"
              onChange={(e) => send(e.target.files?.[0])}
            />
            <span className="muted small">PDF, up to {c.finalFileMaxMb} MB</span>
          </>
        )}
      </div>

      <VendorRow visaCase={c} editable={editable} />
      {c.fileReadyAt && (
        <p className="muted small" style={{ margin: 0 }}>
          Marked file ready by {c.fileReadyBy?.name ?? 'someone'}, {formatDateTime(c.fileReadyAt)}.
        </p>
      )}
    </section>
  )
}

/** "Global Visa Services · Mumbai" */
const vendorLabel = (v: { name: string; city: string }) => `${v.name} · ${v.city}`

const switchedOffChip = <span className="chip chip-muted chip-sm">Switched off</span>
const notCoveringChip = (country: string) => <span className="chip chip-muted chip-sm">No longer covers {country}</span>

/**
 * The vendor the file goes to (0007 Decision 7): picked during File preparation from the active vendors that cover the
 * case's country, and saved as soon as it is picked. A vendor switched off, or no longer covering the country, after
 * being picked stays on the case, flagged, until someone picks another. Not asked for when the visa's "Vendor needed"
 * is off (e-visas).
 */
function VendorRow({ visaCase: c, editable }: { visaCase: VisaCase; editable: boolean }) {
  const { data: me } = useMe()
  const toast = useToast()
  const save = useSetVendor(c.caseNo)
  const vendors = useMasterList('vendors', editable)
  const picked = c.vendor

  if (!picked && !c.vendorNeeded) {
    return (
      <div className="saved-file-vendor">
        <div className="kv">
          <span className="muted">Vendor</span>
          <span className="muted small">This visa needs no vendor.</span>
        </div>
      </div>
    )
  }

  const options = (vendors.data ?? []).filter((v) => v.isActive && v.countries.some((country) => country.id === c.country.id))
  const pickedListed = !!picked && options.some((v) => v.id === picked.id)

  const pick = (value: string) => {
    const vendorId = value ? Number(value) : null
    save.mutate(
      { vendorId },
      {
        onSuccess: () => toast({ tone: 'ok', message: vendorId ? 'Vendor saved.' : 'Vendor cleared.' }),
        onError: (err) => {
          // Most likely the vendor was switched off since the list loaded: load it again.
          void vendors.refetch()
          toast({ tone: 'bad', message: errorBody(err)?.issues?.vendorId?.[0] ?? errorText(err) ?? 'Couldn’t save. Please try again.' })
        },
      },
    )
  }

  return (
    <div className="saved-file-vendor">
      {editable ? (
        // Label above, full width: like the other pickers on the case (the demo shows only the read-only row).
        <label className="field">
          <span className="lbl">Vendor the file goes to</span>
          <select
            className="select"
            value={picked?.id ?? ''}
            disabled={vendors.isPending || save.isPending}
            onChange={(e) => pick(e.target.value)}
          >
            <option value="">{vendors.isPending ? 'Loading…' : picked ? 'None' : 'Pick a vendor…'}</option>
            {picked && !pickedListed && (
              <option value={picked.id} disabled>
                {vendorLabel(picked)}
                {!picked.isActive ? ' (switched off)' : picked.coversCountry ? '' : ` (doesn’t cover ${c.country.name})`}
              </option>
            )}
            {options.map((v) => (
              <option key={v.id} value={v.id}>
                {vendorLabel(v)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="kv">
          <span className="muted">Vendor</span>
          {picked ? (
            <strong className="saved-file-vendor-name">
              {vendorLabel(picked)} {!picked.isActive ? switchedOffChip : !picked.coversCountry && notCoveringChip(c.country.name)}
            </strong>
          ) : (
            <span className="muted">Not picked yet</span>
          )}
        </div>
      )}
      {picked && <VendorContact vendor={picked} />}
      {editable && picked && !picked.isActive && (
        <p className="small saved-file-vendor-note">{switchedOffChip} Pick an active vendor before the file is ready.</p>
      )}
      {editable && picked && picked.isActive && !picked.coversCountry && (
        <p className="small saved-file-vendor-note">
          {notCoveringChip(c.country.name)} Pick a vendor that covers {c.country.name} before the file is ready.
        </p>
      )}
      {editable && vendors.isSuccess && options.length === 0 && (
        <p className="muted small saved-file-vendor-note">
          {me && canEditVisaMasters(me) ? (
            <>
              No vendor covers {c.country.name} yet. <Link to="/settings/masters/lists?tab=vendors">Add one in Vendors</Link>
            </>
          ) : (
            `No vendor covers ${c.country.name} yet — ask the Visa HOD to add one.`
          )}
        </p>
      )}
    </div>
  )
}

/** The contact person and mobile from the vendor master, for the next-day "did you get it?" call. */
function VendorContact({ vendor: v }: { vendor: CaseVendor }) {
  if (!v.contactName && !v.mobile) return null
  return (
    <p className="muted small saved-file-vendor-note">
      {[v.contactName, v.mobile && formatMobile(v.mobile)].filter(Boolean).join(' · ')}
    </p>
  )
}
