/**
 * Unified Professional Report Print Utility
 * =========================================
 *
 * This module exports a single function `printReportDocument` that opens a
 * standalone print window with:
 *   - A bilingual letterhead (logo + company AR/EN + branch + VAT + phone)
 *   - A report-info bar (report number | period | generated-by | generated-at)
 *   - The caller's HTML body
 *   - A fixed-position footer that prints on EVERY page (company | timestamp |
 *     "Page X of Y" via CSS `counter(page)` / `counter(pages)`)
 *
 * Three form factors are supported: A4 (default), thermal 80mm, thermal 58mm.
 * All styling is inlined — NO external CDN fonts — so it works fully offline.
 *
 * The POS invoice receipt (src/lib/receipt-template.ts) is intentionally NOT
 * touched; this utility is for back-office/accounting reports only.
 */

export type ReportFormat = 'A4' | 'thermal80' | 'thermal58';
export type ReportOrientation = 'portrait' | 'landscape';

export interface PrintReportOptions {
  /** Arabic title of the report */
  title: string;
  /** English title (optional, rendered under the Arabic title) */
  titleEn?: string;
  /** Subtitle (e.g. period description) */
  subtitle?: string;
  /** Auto-generated reference number, e.g. IS-2025-001 */
  reportNumber?: string;
  /** Company info from /api/settings */
  company: {
    name: string;
    nameEn?: string;
    /** base64 data URL */
    logo?: string;
    taxNumber?: string;
    crNumber?: string;
    phone?: string;
    email?: string;
    address?: string;
    addressEn?: string;
  };
  /** Branch info from /api/branches (optional — omit for HQ-wide reports) */
  branch?: {
    name: string;
    nameEn?: string;
    address?: string;
    phone?: string;
  };
  /** Date range covered by the report */
  period?: { from: string; to: string };
  /** Name of the user generating the report */
  generatedBy: string;
  /** The report body HTML (tables, cards, sections, etc.) */
  contentHtml: string;
  /** Page format. Defaults to 'A4'. */
  format?: ReportFormat;
  /** Page orientation. Defaults to 'portrait'. */
  orientation?: ReportOrientation;
}

/* ------------------------------------------------------------------ */
/* CSS builders per format                                            */
/* ------------------------------------------------------------------ */

function buildA4Css(orientation: ReportOrientation): string {
  const size = orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: 'Cairo', sans-serif;
    direction: rtl;
    color: #111827;
    background: #ffffff;
    font-size: 11pt;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { padding: 10mm; }
  @page {
    size: ${size};
    margin: 10mm 10mm 18mm 10mm;
  }

  /* ── Letterhead ────────────────────────────────────────────────── */
  .letterhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 2px solid #1f2937;
  }
  .letterhead .logo {
    max-width: 130px;
    max-height: 70px;
    object-fit: contain;
  }
  .letterhead .logo-slot { width: 130px; flex-shrink: 0; }
  .letterhead .company {
    flex: 1;
    text-align: center;
  }
  .letterhead .company h1 {
    font-size: 18pt;
    font-weight: 700;
    color: #111827;
    letter-spacing: -0.2px;
  }
  .letterhead .company .company-en {
    font-size: 11pt;
    color: #4b5563;
    font-weight: 600;
    margin-top: 2px;
    letter-spacing: 0.3px;
  }
  .letterhead .company .company-tagline {
    font-size: 9pt;
    color: #6b7280;
    margin-top: 4px;
  }
  .letterhead .meta {
    flex-shrink: 0;
    text-align: left;
    font-size: 9pt;
    line-height: 1.5;
    color: #374151;
    min-width: 160px;
  }
  .letterhead .meta .meta-line {
    display: block;
    white-space: nowrap;
  }
  .letterhead .meta .meta-label {
    font-weight: 700;
    color: #111827;
  }
  .letterhead .meta .meta-line.en {
    direction: ltr;
  }

  /* ── Report title ──────────────────────────────────────────────── */
  .report-title {
    text-align: center;
    margin: 4px 0 8px;
  }
  .report-title h2 {
    font-size: 16pt;
    font-weight: 700;
    color: #111827;
  }
  .report-title .report-title-en {
    font-size: 10pt;
    color: #4b5563;
    font-weight: 600;
    margin-top: 2px;
  }
  .report-title .subtitle {
    font-size: 10pt;
    color: #4b5563;
    margin-top: 4px;
  }

  /* ── Report info bar (ref-no | period | generated-by | generated-at) ── */
  .info-bar {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 6px 14px;
    background: #f8fafc;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 12px;
    font-size: 9pt;
    color: #1f2937;
  }
  .info-bar .info-item {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .info-bar .info-label {
    font-weight: 700;
    color: #6b7280;
  }
  .info-bar .info-value {
    font-weight: 600;
    color: #111827;
  }
  .info-bar .info-value.en { direction: ltr; }

  /* ── Body content ──────────────────────────────────────────────── */
  .report-body { width: 100%; }

  /* ── Tables ────────────────────────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 10px;
    font-size: 10pt;
  }
  thead th {
    background: #f1f5f9 !important;
    color: #111827;
    font-weight: 700;
    text-align: right;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-bottom: 2px solid #1f2937;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  tbody td {
    padding: 5px 10px;
    border: 1px solid #e5e7eb;
    vertical-align: top;
    color: #111827;
  }
  tbody tr:nth-child(even) td {
    background: #f9fafb !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  td.num, th.num {
    direction: ltr;
    text-align: left;
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum';
    font-family: 'Roboto Mono', 'Courier New', monospace;
  }
  td.text-left, th.text-left { text-align: left; direction: ltr; }
  td.text-center, th.text-center { text-align: center; }
  td.text-right, th.text-right { text-align: right; }

  /* ── Totals row ───────────────────────────────────────────────── */
  tr.total-row td {
    background: #f8fafc !important;
    font-weight: 700;
    border-top: 2px solid #1f2937;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  tfoot tr td {
    background: #f1f5f9 !important;
    font-weight: 700;
    border-top: 2px solid #1f2937;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Section & card primitives ────────────────────────────────── */
  .section {
    margin-bottom: 14px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 12pt;
    font-weight: 700;
    color: #111827;
    padding: 6px 10px;
    background: #f1f5f9;
    border-right: 4px solid #047857;
    border-radius: 3px;
    margin: 14px 0 8px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .card {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 10px;
    page-break-inside: avoid;
  }
  .card-header {
    font-weight: 700;
    font-size: 11pt;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 5px 0;
    border-bottom: 1px dotted #cbd5e1;
    font-size: 10pt;
  }
  .summary-total {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0 4px;
    font-weight: 700;
    font-size: 12pt;
    border-top: 2px solid #1f2937;
    margin-top: 6px;
  }

  /* ── Summary cards (3-col grid) ───────────────────────────────── */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .summary-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
  .summary-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .summary-card {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 10px;
    text-align: center;
    page-break-inside: avoid;
  }
  .summary-card label {
    display: block;
    font-size: 9pt;
    color: #4b5563;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .summary-card .value {
    font-weight: 700;
    font-size: 13pt;
    color: #111827;
    direction: ltr;
    font-variant-numeric: tabular-nums;
    font-family: 'Roboto Mono', 'Courier New', monospace;
  }
  .summary-card .value.green { color: #047857; }
  .summary-card .value.red { color: #b91c1c; }
  .summary-card .value.blue { color: #1d4ed8; }
  .summary-card .value.amber { color: #b45309; }

  /* ── Badges ───────────────────────────────────────────────────── */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 8pt;
    font-weight: 700;
    color: #1f2937;
  }
  .badge-green { background: #dcfce7 !important; border-color: #86efac; color: #166534; }
  .badge-red { background: #fee2e2 !important; border-color: #fca5a5; color: #991b1b; }
  .badge-amber { background: #fef3c7 !important; border-color: #fcd34d; color: #92400e; }
  .badge-blue { background: #dbeafe !important; border-color: #93c5fd; color: #1e40af; }

  /* ── Utility classes (Tailwind-like) ──────────────────────────── */
  .font-mono { font-family: 'Roboto Mono', 'Courier New', monospace; }
  .font-bold { font-weight: 700; }
  .text-sm { font-size: 9pt; }
  .text-lg { font-size: 13pt; }
  .text-xl { font-size: 16pt; }
  .text-green { color: #047857; }
  .text-red { color: #b91c1c; }
  .text-muted { color: #6b7280; }
  .mb-2 { margin-bottom: 8px; }
  .mb-3 { margin-bottom: 12px; }
  .mb-4 { margin-bottom: 16px; }
  .mt-2 { margin-top: 8px; }
  .mt-3 { margin-top: 12px; }
  .mt-4 { margin-top: 16px; }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .items-center { align-items: center; }
  .gap-2 { gap: 8px; }
  .gap-3 { gap: 12px; }
  .gap-4 { gap: 16px; }
  .grid { display: grid; }
  .grid-cols-2 { grid-template-columns: repeat(2, 1fr); }
  .grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-cols-4 { grid-template-columns: repeat(4, 1fr); }
  .p-3 { padding: 12px; }
  .p-4 { padding: 16px; }
  .border { border: 1px solid #ccc; }
  .rounded { border-radius: 4px; }

  .page-break-before { page-break-before: always; }
  .page-break-after { page-break-after: always; }

  /* ── Footer (prints on every page) ────────────────────────────── */
  #print-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 14mm;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10mm;
    border-top: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 8pt;
    color: #4b5563;
  }
  #print-footer .footer-company {
    font-weight: 700;
    color: #1f2937;
  }
  #print-footer .footer-timestamp {
    direction: ltr;
  }
  #print-footer .footer-page {
    font-weight: 600;
  }

  /* Reserve space at the bottom so the fixed footer never overlaps content */
  .report-body { min-height: calc(100vh - 80mm); }
  body { padding-bottom: 18mm; }

  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
  @media screen {
    body { background: #f3f4f6; }
    .report-page {
      max-width: 210mm;
      margin: 0 auto;
      background: #ffffff;
      padding: 12mm;
      box-shadow: 0 1px 6px rgba(0,0,0,0.08);
    }
  }
  `;
}

function buildThermalCss(widthMm: number, marginMm: number, fontPt: number): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: 'Cairo', sans-serif;
    direction: rtl;
    color: #000;
    background: #ffffff;
    font-size: ${fontPt}pt;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { padding: ${marginMm}mm; width: ${widthMm}mm; }
  @page {
    size: ${widthMm}mm auto;
    margin: ${marginMm}mm;
  }

  /* Stacked letterhead */
  .letterhead {
    text-align: center;
    padding-bottom: 6px;
    margin-bottom: 6px;
    border-bottom: 1px dashed #000;
  }
  .letterhead .logo {
    max-width: ${Math.min(60, widthMm - 8)}mm;
    max-height: 24mm;
    object-fit: contain;
    margin: 0 auto 4px;
    display: block;
  }
  .letterhead .logo-slot { display: none; }
  .letterhead .company h1 {
    font-size: ${fontPt + 3}pt;
    font-weight: 700;
  }
  .letterhead .company .company-en {
    font-size: ${fontPt}pt;
    color: #333;
    font-weight: 600;
  }
  .letterhead .company .company-tagline { display: none; }
  .letterhead .meta {
    margin-top: 4px;
    font-size: ${fontPt - 1}pt;
    line-height: 1.5;
    color: #000;
    text-align: center;
  }
  .letterhead .meta .meta-line {
    display: block;
  }
  .letterhead .meta .meta-line.en { direction: ltr; }

  .report-title {
    text-align: center;
    margin: 4px 0 6px;
  }
  .report-title h2 {
    font-size: ${fontPt + 2}pt;
    font-weight: 700;
  }
  .report-title .report-title-en {
    font-size: ${fontPt}pt;
    color: #333;
  }
  .report-title .subtitle {
    font-size: ${fontPt - 1}pt;
    color: #333;
    margin-top: 2px;
  }

  .info-bar {
    background: #f0f0f0;
    border: 1px dashed #999;
    padding: 4px 6px;
    margin-bottom: 8px;
    font-size: ${fontPt - 1}pt;
    color: #000;
    text-align: center;
  }
  .info-bar .info-item {
    display: block;
    margin: 1px 0;
  }
  .info-bar .info-label {
    font-weight: 700;
    color: #000;
  }
  .info-bar .info-value {
    font-weight: 700;
    color: #000;
  }
  .info-bar .info-value.en { direction: ltr; }

  .report-body { width: 100%; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 4px 0 8px;
    font-size: ${fontPt - 1}pt;
  }
  thead th {
    background: #f0f0f0 !important;
    color: #000;
    font-weight: 700;
    text-align: right;
    padding: 3px 4px;
    border-bottom: 1px solid #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  tbody td {
    padding: 2px 4px;
    border-bottom: 1px dotted #999;
    vertical-align: top;
  }
  /* No zebra striping on thermal — saves ink */
  td.num, th.num {
    direction: ltr;
    text-align: left;
    font-variant-numeric: tabular-nums;
    font-family: 'Roboto Mono', 'Courier New', monospace;
  }
  td.text-left, th.text-left { text-align: left; direction: ltr; }
  td.text-center, th.text-center { text-align: center; }
  td.text-right, th.text-right { text-align: right; }
  tr.total-row td {
    background: #f8f8f8 !important;
    font-weight: 700;
    border-top: 1px solid #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  tfoot tr td {
    background: #f0f0f0 !important;
    font-weight: 700;
    border-top: 1px solid #000;
  }

  .section { margin-bottom: 8px; page-break-inside: avoid; }
  .section-title {
    font-size: ${fontPt + 1}pt;
    font-weight: 700;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
    margin: 6px 0 4px;
  }
  .card {
    border: 1px dashed #999;
    padding: 4px 6px;
    margin-bottom: 6px;
    page-break-inside: avoid;
  }
  .card-header {
    font-weight: 700;
    margin-bottom: 4px;
    padding-bottom: 2px;
    border-bottom: 1px dotted #999;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    border-bottom: 1px dotted #999;
    font-size: ${fontPt - 1}pt;
  }
  .summary-total {
    display: flex;
    justify-content: space-between;
    padding: 4px 0 2px;
    font-weight: 700;
    font-size: ${fontPt + 1}pt;
    border-top: 1px solid #000;
    margin-top: 4px;
  }
  /* Stack summary cards vertically on thermal */
  .summary-grid {
    display: block;
    margin-bottom: 8px;
  }
  .summary-card {
    display: flex;
    justify-content: space-between;
    border: 1px dashed #999;
    padding: 3px 6px;
    margin-bottom: 2px;
  }
  .summary-card label { font-size: ${fontPt - 1}pt; font-weight: 700; color: #000; }
  .summary-card .value {
    font-weight: 700;
    font-size: ${fontPt}pt;
    direction: ltr;
    font-variant-numeric: tabular-nums;
    font-family: 'Roboto Mono', 'Courier New', monospace;
  }
  .summary-card .value.green { color: #047857; }
  .summary-card .value.red { color: #b91c1c; }
  .summary-card .value.blue { color: #1d4ed8; }
  .summary-card .value.amber { color: #b45309; }

  .badge {
    display: inline-block;
    padding: 1px 4px;
    border: 1px solid #999;
    border-radius: 2px;
    font-size: ${fontPt - 2}pt;
    font-weight: 700;
    color: #000;
  }
  .badge-green { background: #e8f5e9; border-color: #999; color: #1b5e20; }
  .badge-red { background: #ffebee; border-color: #999; color: #b71c1c; }
  .badge-amber { background: #fff8e1; border-color: #999; color: #bf360c; }
  .badge-blue { background: #e3f2fd; border-color: #999; color: #0d47a1; }

  .font-mono { font-family: 'Roboto Mono', 'Courier New', monospace; }
  .font-bold { font-weight: 700; }
  .text-sm { font-size: ${fontPt - 2}pt; }
  .text-lg { font-size: ${fontPt + 2}pt; }
  .text-green { color: #047857; }
  .text-red { color: #b91c1c; }
  .text-muted { color: #555; }
  .mb-2 { margin-bottom: 4px; }
  .mb-3 { margin-bottom: 6px; }
  .mb-4 { margin-bottom: 8px; }
  .mt-2 { margin-top: 4px; }
  .mt-3 { margin-top: 6px; }
  .mt-4 { margin-top: 8px; }
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .items-center { align-items: center; }
  .gap-2 { gap: 4px; }
  .gap-3 { gap: 6px; }
  .gap-4 { gap: 8px; }
  .grid { display: block; }
  .grid-cols-2, .grid-cols-3, .grid-cols-4 { display: block; }
  .p-3 { padding: 6px; }
  .p-4 { padding: 8px; }
  .border { border: 1px solid #999; }
  .rounded { border-radius: 2px; }

  .page-break-before { page-break-before: always; }
  .page-break-after { page-break-after: always; }

  /* Thermal footer: simpler (no page counter — most thermal printers ignore it) */
  #print-footer {
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed #000;
    text-align: center;
    font-size: ${fontPt - 2}pt;
    color: #000;
  }
  #print-footer .footer-company { font-weight: 700; }
  #print-footer .footer-timestamp { direction: ltr; display: block; }
  #print-footer .footer-page { display: block; }

  @media print {
    body { padding: ${marginMm}mm; }
    .no-print { display: none !important; }
  }
  @media screen {
    body { background: #f3f4f6; padding: 12px; }
    .report-page {
      background: #ffffff;
      width: ${widthMm}mm;
      margin: 0 auto;
      padding: ${marginMm}mm;
      box-shadow: 0 1px 6px rgba(0,0,0,0.1);
    }
  }
  `;
}

/* ------------------------------------------------------------------ */
/* HTML builders                                                       */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildLetterhead(opts: PrintReportOptionsInternal, isThermal: boolean): string {
  const { company, branch } = opts;
  const logoSlot = company.logo
    ? `<img src="${company.logo}" class="logo" alt="${escapeHtml(company.name)} logo" />`
    : `<div class="logo-slot"></div>`;

  // For A4: logo on the right (RTL start), company center, branch+vat+phone on the left.
  // For thermal: everything stacked center.
  if (isThermal) {
    return `
    <div class="letterhead">
      ${company.logo ? `<img src="${company.logo}" class="logo" alt="${escapeHtml(company.name)} logo" />` : ''}
      <div class="company">
        <h1>${escapeHtml(company.name)}</h1>
        ${company.nameEn ? `<div class="company-en">${escapeHtml(company.nameEn)}</div>` : ''}
      </div>
      <div class="meta">
        ${branch ? `<span class="meta-line">${escapeHtml(branch.name)}${branch.nameEn ? ` / ${escapeHtml(branch.nameEn)}` : ''}</span>` : ''}
        ${company.taxNumber ? `<span class="meta-line en">VAT: ${escapeHtml(company.taxNumber)}</span>` : ''}
        ${company.crNumber ? `<span class="meta-line en">CR: ${escapeHtml(company.crNumber)}</span>` : ''}
        ${company.phone ? `<span class="meta-line en">${escapeHtml(company.phone)}</span>` : ''}
        ${company.email ? `<span class="meta-line en">${escapeHtml(company.email)}</span>` : ''}
        ${company.address ? `<span class="meta-line">${escapeHtml(company.address)}</span>` : ''}
      </div>
    </div>`;
  }

  return `
  <div class="letterhead">
    <div class="logo-slot">${company.logo ? `<img src="${company.logo}" class="logo" alt="${escapeHtml(company.name)} logo" />` : ''}</div>
    <div class="company">
      <h1>${escapeHtml(company.name)}</h1>
      ${company.nameEn ? `<div class="company-en">${escapeHtml(company.nameEn)}</div>` : ''}
      ${(company.address || company.addressEn) ? `<div class="company-tagline">${escapeHtml(company.address || '')}${company.address && company.addressEn ? ' · ' : ''}${company.addressEn ? escapeHtml(company.addressEn) : ''}</div>` : ''}
    </div>
    <div class="meta">
      ${branch ? `<span class="meta-line"><span class="meta-label">${escapeHtml(opts._i18n?.branchLabel || 'الفرع')}:</span> ${escapeHtml(branch.name)}${branch.nameEn ? ` / ${escapeHtml(branch.nameEn)}` : ''}</span>` : ''}
      ${company.taxNumber ? `<span class="meta-line en"><span class="meta-label">VAT:</span> ${escapeHtml(company.taxNumber)}</span>` : ''}
      ${company.crNumber ? `<span class="meta-line en"><span class="meta-label">CR:</span> ${escapeHtml(company.crNumber)}</span>` : ''}
      ${company.phone ? `<span class="meta-line en"><span class="meta-label">Tel:</span> ${escapeHtml(company.phone)}</span>` : ''}
      ${company.email ? `<span class="meta-line en"><span class="meta-label">Email:</span> ${escapeHtml(company.email)}</span>` : ''}
    </div>
  </div>`;
}

function buildReportTitle(opts: PrintReportOptionsInternal): string {
  return `
  <div class="report-title">
    <h2>${escapeHtml(opts.title)}</h2>
    ${opts.titleEn ? `<div class="report-title-en">${escapeHtml(opts.titleEn)}</div>` : ''}
    ${opts.subtitle ? `<div class="subtitle">${escapeHtml(opts.subtitle)}</div>` : ''}
  </div>`;
}

function buildInfoBar(opts: PrintReportOptionsInternal, generatedAt: Date): string {
  const items: string[] = [];
  if (opts.reportNumber) {
    items.push(`<div class="info-item"><span class="info-label">${escapeHtml(opts._i18n?.reportNoLabel || 'رقم التقرير')}:</span> <span class="info-value en">${escapeHtml(opts.reportNumber)}</span></div>`);
  }
  if (opts.period && (opts.period.from || opts.period.to)) {
    items.push(`<div class="info-item"><span class="info-label">${escapeHtml(opts._i18n?.periodLabel || 'الفترة')}:</span> <span class="info-value en">${escapeHtml(opts.period.from || '—')} → ${escapeHtml(opts.period.to || '—')}</span></div>`);
  }
  if (opts.generatedBy) {
    items.push(`<div class="info-item"><span class="info-label">${escapeHtml(opts._i18n?.generatedByLabel || 'إعداد')}:</span> <span class="info-value">${escapeHtml(opts.generatedBy)}</span></div>`);
  }
  items.push(`<div class="info-item"><span class="info-label">${escapeHtml(opts._i18n?.generatedAtLabel || 'بتاريخ')}:</span> <span class="info-value en">${escapeHtml(formatTimestamp(generatedAt))}</span></div>`);

  return `<div class="info-bar">${items.join('')}</div>`;
}

function buildFooter(opts: PrintReportOptionsInternal, generatedAt: Date, isThermal: boolean): string {
  const ts = escapeHtml(formatTimestamp(generatedAt));
  if (isThermal) {
    return `
    <div id="print-footer">
      <span class="footer-company">${escapeHtml(opts.company.name)}</span>
      <span class="footer-timestamp">${ts}</span>
      <span class="footer-page"></span>
    </div>`;
  }
  return `
  <div id="print-footer">
    <span class="footer-company">${escapeHtml(opts.company.name)}${opts.branch ? ` · ${escapeHtml(opts.branch.name)}` : ''}</span>
    <span class="footer-timestamp">${ts}</span>
    <span class="footer-page">${escapeHtml(opts._i18n?.pageLabel || 'صفحة')} <span class="page-num"></span> / <span class="page-count"></span></span>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

// Internal helper: optional i18n labels passed through from callers.
// We attach this via a private symbol-ish key to avoid bloating the public API.
interface PrintReportOptionsInternal extends PrintReportOptions {
  _i18n?: {
    branchLabel?: string;
    reportNoLabel?: string;
    periodLabel?: string;
    generatedByLabel?: string;
    generatedAtLabel?: string;
    pageLabel?: string;
  };
}

/**
 * Open a new print window, render the report, fire print(), then close.
 *
 * Returns `true` if the window was successfully opened, `false` if the popup
 * was blocked.
 */
export function printReportDocument(options: PrintReportOptions): boolean {
  // Allow callers to pass i18n labels via a hidden field. Default to Arabic.
  const opts = options as PrintReportOptionsInternal;
  if (!opts._i18n) {
    opts._i18n = {
      branchLabel: 'الفرع',
      reportNoLabel: 'رقم التقرير',
      periodLabel: 'الفترة',
      generatedByLabel: 'إعداد',
      generatedAtLabel: 'بتاريخ',
      pageLabel: 'صفحة',
    };
  }

  const format: ReportFormat = opts.format ?? 'A4';
  const orientation: ReportOrientation = opts.orientation ?? 'portrait';
  const generatedAt = new Date();
  const isThermal = format === 'thermal80' || format === 'thermal58';

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    return false;
  }

  let css: string;
  if (format === 'A4') {
    css = buildA4Css(orientation);
  } else if (format === 'thermal80') {
    css = buildThermalCss(80, 4, 9);
  } else {
    css = buildThermalCss(58, 2, 7);
  }

  const letterhead = buildLetterhead(opts, isThermal);
  const reportTitle = buildReportTitle(opts);
  const infoBar = buildInfoBar(opts, generatedAt);
  const footer = buildFooter(opts, generatedAt, isThermal);

  const doc = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="report-page">
    ${letterhead}
    ${reportTitle}
    ${infoBar}
    <div class="report-body">
      ${opts.contentHtml}
    </div>
    ${footer}
  </div>
  <script>
    (function() {
      // Resolve "Page X of Y" using a hidden paginator that runs at print time.
      // CSS counters (counter(page)/counter(pages)) don't work inside the
      // body's fixed-position footer reliably across browsers, so we use a
      // print-listener fallback that reads the page number from a sentinel.
      try {
        var pageNumEls = document.querySelectorAll('.page-num');
        var pageCountEls = document.querySelectorAll('.page-count');
        // Use CSS counter() in content() — works in Chrome/Edge/Safari when
        // applied to a pseudo-element of #print-footer.
        var style = document.createElement('style');
        style.textContent =
          '@media print {' +
          '  #print-footer .footer-page::after {' +
          '    content: "${escapeHtml(opts._i18n?.pageLabel || 'صفحة')} " counter(page) " / " counter(pages);' +
          '  }' +
          '  #print-footer .footer-page .page-num,' +
          '  #print-footer .footer-page .page-count { display: none; }' +
          '}';
        document.head.appendChild(style);
      } catch (e) {}

      // Trigger print after fonts are ready (3s timeout) then close.
      var trigger = function() {
        try { window.focus(); window.print(); } catch (e) {}
        setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);
      };
      try {
        Promise.race([
          (document.fonts && document.fonts.ready) || Promise.resolve(),
          new Promise(function(r) { setTimeout(r, 3000); })
        ]).then(function() {
          setTimeout(trigger, 250);
        });
      } catch (e) {
        setTimeout(trigger, 500);
      }
    })();
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(doc);
  printWindow.document.close();

  return true;
}

/**
 * Helper: fetch company info from /api/settings.
 * Returns a shape compatible with the `company` field of PrintReportOptions.
 */
export async function fetchCompanyInfoForPrint(): Promise<PrintReportOptions['company']> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return { name: '' };
    const map = await res.json();
    return {
      name: map.companyName || '',
      nameEn: map.companyNameEn || '',
      logo: map.logo || '',
      taxNumber: map.taxNumber || '',
      crNumber: map.crNumber || '',
      phone: map.phone || '',
      email: map.email || '',
      address: map.address || '',
      addressEn: map.addressEn || '',
    };
  } catch {
    return { name: '' };
  }
}

/**
 * Helper: fetch branch info from /api/branches by branch code/id.
 * Returns the matching branch or undefined if not found / not available.
 */
export async function fetchBranchInfoForPrint(
  branchKey: string | null | undefined
): Promise<PrintReportOptions['branch'] | undefined> {
  if (!branchKey) return undefined;
  try {
    const res = await fetch('/api/branches');
    if (!res.ok) return undefined;
    const list = await res.json();
    const arr = Array.isArray(list) ? list : [];
    const match = arr.find((b: any) =>
      b.id === branchKey || b.code === branchKey || b.name === branchKey
    );
    if (!match) return undefined;
    return {
      name: match.name || '',
      nameEn: match.nameEn || '',
      address: match.address || '',
      phone: match.phone || '',
    };
  } catch {
    return undefined;
  }
}

/**
 * Build an auto-generated report reference number, e.g. IS-20250115-1430
 */
export function generateReportNumber(prefix: string, d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
