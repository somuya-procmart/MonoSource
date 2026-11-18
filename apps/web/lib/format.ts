export const inr = (n: number | string | null | undefined, digits = 0) => n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const price = (n: number | string | null | undefined) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const dmy = (d?: string | null) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const ago = (d?: string | null) => { if (!d) return ''; const s = (Date.now() - new Date(d).getTime()) / 1000; if (s < 0) return dmy(d); if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; if (s < 86400 * 2) return 'yesterday'; if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`; return dmy(d); };
export const daysLeft = (d?: string | null) => d ? Math.round((new Date(d + 'T00:00:00').getTime() - Date.now()) / 864e5) : null;
export const num = (n: any) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** One vocabulary for order and requirement status, used everywhere. SAP-side steps say so. */
export const STATUS_LABEL: Record<string, string> = {
  pr_requested: 'Sending to SAP', pr_created: 'Requisition in SAP', pr_failed: 'Not sent to SAP', po_released: 'PO released',
  acknowledged: 'Supplier confirmed', partially_dispatched: 'Partly dispatched', dispatched: 'In transit', delivered: 'Delivered',
  partially_received: 'Partly received', grn_posted: 'Received', invoiced: 'Invoiced', paid: 'Paid', closed: 'Completed', routed: 'Submitted', returned: 'Returned to you',
  submitted: 'Submitted', in_progress: 'In progress', open: 'Open', completed: 'Completed', cancelled: 'Cancelled', draft: 'Draft',
};
export const statusLabel = (s?: string | null) => s ? STATUS_LABEL[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';
/** Tone: ok = finished well · bad = blocked · warn = partial / needs a look · pri = moving normally · '' = neutral */
export const STATUS_TONE = (s: string) => ['paid', 'closed', 'grn_posted', 'completed', 'delivered'].includes(s) ? 'ok' : ['pr_failed'].includes(s) ? 'bad' : ['partially_dispatched', 'partially_received'].includes(s) ? 'warn' : ['cancelled', 'draft'].includes(s) ? '' : 'pri';
export const RFQ_STATUS: Record<string, [string, string]> = { open: ['Collecting quotes', 'warn'], closed: ['Ready to award', 'pri'], awarded: ['Awarded', 'ok'], cancelled: ['Cancelled', ''] };
export const CONTRACT_STATUS: Record<string, [string, string]> = { draft: ['Draft', ''], extracting: ['Reading document', 'pri'], in_review: ['In review', 'warn'], approved: ['Approved · not yet live', 'pri'], published: ['Live', 'ok'], rejected: ['Rejected', 'bad'], expired: ['Expired', ''] };

/** Category names: short acronyms stay upper case (PPE), others get a capital first letter. */
export const catLabel = (c?: string | null) => !c ? '' : c.length <= 3 ? c.toUpperCase() : c.charAt(0).toUpperCase() + c.slice(1);

/** Agents work behind the scenes: user-facing text says "MonoSource", except the follow-up, which people want to see. */
export const plain = (t?: string | null) => !t ? '' : t
  .replace(/Follow-up Agent/g, 'Follow-up')
  .replace(/\b(?:Supplier Outreach|Quotation Processing|Procurement Coordination|Discovery|Comparison|Coordination|Outreach) Agent\b/g, 'MonoSource');
