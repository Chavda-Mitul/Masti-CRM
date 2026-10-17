import { Fragment, useState, type ReactNode } from 'react'
import { formatDateTime } from '../../lib/format'
import { AddScanDialog } from './AddScanDialog'
import { errorText } from './apiErrors'
import { useClientDocuments, useOpenClientDocument } from './queries'
import { scanSummary } from './scanFiles'
import type { ClientDocumentGroup, ClientDocumentScan, ClientProfile } from './types'

/**
 * The client document vault (docs/decisions/0016-client-documents.md): every scan of the client's papers, by person,
 * each paper's current scan with its older copies behind it. Only HODs and the Head get this card (the server refuses
 * anyone else too). Nothing in it is ever changed or deleted.
 */
export function DocumentsCard({ client }: { client: ClientProfile }) {
  const documents = useClientDocuments(client.id, true)
  const open = useOpenClientDocument(client.id)
  const [adding, setAdding] = useState(false)
  // Papers whose older copies are showing, as "person:paper".
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setExpanded((keys) => {
      const next = new Set(keys)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const vault = documents.data
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="pad card-head">
        <h2 className="h2">Documents</h2>
        <div className="row-actions doc-actions">
          <span className="hint">HODs and the Head only</span>
          <button className="btn btn-sm" onClick={() => setAdding(true)} disabled={!vault}>
            + Add a scan
          </button>
        </div>
      </div>

      {documents.isPending && (
        <div className="pad muted" style={{ paddingTop: 0 }}>
          Loading…
        </div>
      )}
      {errorText(documents.error) && <div className="pad alert alert-bad">{errorText(documents.error)}</div>}
      {vault?.groups.length === 0 && (
        <div className="pad muted" style={{ paddingTop: 0 }}>
          No scans yet. Scan a passport, Aadhaar card or any other paper once, and it’s here for every later trip.
        </div>
      )}
      {vault && vault.groups.length > 0 && (
        <table className="table doc-table">
          <thead>
            <tr>
              <th>Paper</th>
              <th>File</th>
              <th>Saved</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          {vault.groups.map((group) => (
            <tbody key={group.member?.id ?? 'own'}>
              <tr className="doc-person">
                <th colSpan={4} scope="rowgroup">
                  {whose(group)}
                  {group.member?.archived && <span className="chip chip-muted chip-sm">Taken off the list</span>}
                </th>
              </tr>
              {group.papers.map(({ paper, current, older }) => {
                const key = `${group.member?.id ?? 'own'}:${paper.id}`
                const showOlder = expanded.has(key)
                return (
                  <Fragment key={key}>
                    <ScanRow scan={current} onOpen={open}>
                      <div className="doc-paper">{paper.name}</div>
                      {older.length > 0 && (
                        <button type="button" className="btn-link small" onClick={() => toggle(key)} aria-expanded={showOlder}>
                          {showOlder ? 'Hide older copies' : `Older copies (${older.length})`}
                        </button>
                      )}
                    </ScanRow>
                    {showOlder &&
                      older.map((scan) => (
                        <ScanRow key={scan.id} scan={scan} onOpen={open} older>
                          <span className="muted small">Older copy</span>
                        </ScanRow>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          ))}
        </table>
      )}

      {adding && vault && <AddScanDialog client={client} vault={vault} onClose={() => setAdding(false)} />}
    </div>
  )
}

/** "Aarav Mehta · Son", or the client's own papers (a company's PAN card), which are no one person's. */
function whose(group: ClientDocumentGroup) {
  return group.member ? `${group.member.name} · ${group.member.relation}` : 'Not one person’s: the client’s own papers'
}

function ScanRow({ scan, onOpen, older = false, children }: { scan: ClientDocumentScan; onOpen: (id: string) => void; older?: boolean; children: ReactNode }) {
  return (
    <tr className={older ? 'doc-older' : undefined}>
      <td>{children}</td>
      <td className="small">{scanSummary(scan)}</td>
      <td className="small">
        {formatDateTime(scan.uploadedAt)} · {scan.uploadedBy.name}
      </td>
      <td className="doc-open">
        <button type="button" className="btn btn-sm" onClick={() => onOpen(scan.id)}>
          Open
        </button>
      </td>
    </tr>
  )
}
