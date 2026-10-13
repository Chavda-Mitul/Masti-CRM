import { CompanyDetailsCard } from './CompanyDetailsCard'
import { InvoiceNumberingCard } from './InvoiceNumberingCard'

/**
 * Settings → Company & invoice (docs/decisions/0009-visa-invoice.md Decision 8): Masti's own details, the invoice's terms,
 * logo and signature, and the invoice series and GST rate. Everyone sees them; the Head changes the details, the Visa
 * HOD or the Head the numbering.
 */
export function CompanyPage() {
  return (
    <div className="company-page">
      <p className="muted" style={{ margin: 0 }}>
        Masti’s own details, printed on parcel stickers and invoices.
      </p>
      <CompanyDetailsCard />
      <div className="company-numbering">
        <InvoiceNumberingCard />
      </div>
    </div>
  )
}
