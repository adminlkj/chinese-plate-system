/**
 * Export data to Excel file — Web/Browser only
 * Uses the xlsx library to generate and download Excel files.
 */

export async function exportToExcel(options: {
  data: any[];
  columns: { key: string; header: string; width?: number }[];
  sheetName?: string;
  fileName?: string;
  title?: string;
  subtitle?: string;
}) {
  const { data, columns, sheetName, fileName, title, subtitle } = options;

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const rows: any[][] = [];
  if (title) {
    rows.push([title]);
    rows.push([]);
  }
  if (subtitle) {
    rows.push([subtitle]);
    rows.push([]);
  }
  rows.push(columns.map((c) => c.header));
  for (const item of data) {
    rows.push(columns.map((c) => item[c.key] ?? ''));
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = columns.map((c) => ({ wch: c.width || 15 }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'بيانات');
  XLSX.writeFile(wb, fileName || `تقرير-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/**
 * Print a report by opening a new window with formatted content.
 */
export function printReport(options: {
  title: string;
  subtitle?: string;
  contentHtml: string;
}) {
  const { title, subtitle, contentHtml } = options;

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    return false;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&display=swap">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Cairo', sans-serif;
          direction: rtl;
          padding: 20px;
          font-size: 11pt;
          line-height: 1.55;
          color: #000;
          background: #fff;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .num, .font-mono, .num-cell {
          font-family: 'Roboto Mono', 'Courier New', monospace !important;
          direction: ltr;
          font-variant-numeric: tabular-nums;
          font-feature-settings: 'tnum';
        }
        .report-header {
          text-align: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #333;
        }
        .report-header h1 { font-size: 20pt; font-weight: 700; margin-bottom: 5px; }
        .report-header .subtitle { font-size: 11pt; color: #555; }
        .report-content { width: 100%; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
        th, td { border: 1px solid #999; padding: 6px 10px; text-align: right; }
        th { background: #f0f0f0 !important; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .text-left { text-align: left; }
        .text-center { text-align: center; }
        .font-mono { font-family: 'Roboto Mono', 'Courier New', monospace; }
        .font-bold { font-weight: 700; }
        .text-sm { font-size: 9pt; }
        .text-lg { font-size: 13pt; }
        .text-xl { font-size: 16pt; }
        .border-b-2 { border-bottom: 2px solid #333; }
        .py-2 { padding-top: 8px; padding-bottom: 8px; }
        .py-3 { padding-top: 12px; padding-bottom: 12px; }
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
        .bg-light { background: #f8f8f8; }
        .text-green { color: #16a34a; }
        .text-red { color: #dc2626; }
        .text-orange { color: #ea580c; }
        .text-muted { color: #666; }
        .badge { display: inline-block; padding: 2px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 8pt; font-weight: 600; }
        .badge-green { background: #dcfce7; border-color: #86efac; color: #166534; }
        .badge-red { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
        .badge-amber { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
        .section-title { font-size: 14pt; font-weight: 700; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
        .summary-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dotted #ccc; }
        .summary-total { display: flex; justify-content: space-between; padding: 8px 0; font-weight: 700; font-size: 12pt; border-top: 2px solid #333; margin-top: 8px; }
        .card { border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
        .card-header { font-weight: 700; font-size: 12pt; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
        .account-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dotted #ddd; }
        .account-code { font-family: 'Roboto Mono', 'Courier New', monospace; font-size: 9pt; color: #555; }
        @media print { body { margin: 0; padding: 10px; } @page { size: A4; margin: 1cm; } }
      </style>
    </head>
    <body>
      <div class="report-header">
        <h1>${title}</h1>
        ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
      </div>
      <div class="report-content">
        ${contentHtml}
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();

  const waitForResources = async () => {
    try {
      await Promise.race([
        printWindow.document.fonts.ready.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
    try { printWindow.print(); } catch {}
    setTimeout(() => { try { printWindow.close(); } catch {} }, 1000);
  };

  waitForResources();
  return true;
}
