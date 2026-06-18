/**
 * Shared Receipt Template Utility
 * 
 * Generates the complete receipt HTML (content + CSS) that can be:
 * 1. Saved to the database at print time (for exact replica reprinting)
 * 2. Used to generate receipts on-the-fly (for backward compatibility)
 * 
 * This ensures that the POS screen and the receipt archive
 * produce identical receipts.
 * 
 * Receipt format matches professional Saudi restaurant thermal 80mm standard:
 * - Header: Logo, company name (AR/EN), VAT number, branch (AR/EN), phone
 * - Invoice details: Invoice#, date, time, table, customer, phone
 * - Items table: Item (AR+EN), Qty, Unit Price, Amount
 * - Financial summary: Subtotal, Discount, VAT 15%, TOTAL (prominent box)
 * - Payment section: Method, Paid, Status, Change
 * - QR code with scan instruction, VAT label, footer
 */

import { formatNumber, TAX_RATE, PAYMENT_METHOD_LABELS } from '@/lib/types';
import type { PaymentMethod } from '@/lib/types';
import { sanitizeHtml } from '@/lib/api-auth';
import { generateZatcaQR } from './zatca-qr';

// ─── Types ──────────────────────────────────────────────────────

export interface ReceiptItemData {
  id: string;
  name: string;
  nameEn?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productId?: string | null;
}

export interface ReceiptPaymentData {
  id?: string;
  method: string;
  amount: number;
}

export interface ReceiptInvoiceData {
  id: string;
  invoiceNumber: string;
  branch: string;        // branchId (UUID) — used for lookups
  branchId?: string;     // explicit alias (some callers send branchId)
  status: string;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod?: string | null;
  isReturn?: boolean;
  originalInvoiceNumber?: string | null;
  table?: { id: string; name: string } | null;
  items: ReceiptItemData[];
  payments: ReceiptPaymentData[];
  createdAt: string;
}

export interface ReceiptCompanyInfo {
  companyName: string;
  companyNameEn: string;
  taxNumber: string;
  address: string;
  addressEn: string;
  phone: string;
}

/**
 * Per-branch independent settings that OVERRIDE the global ReceiptCompanyInfo
 * when present. Any field set to a non-null value takes precedence over the
 * corresponding global setting. This is what makes each branch's receipts
 * show that branch's own logo, name, phone, address, VAT number, tax rate,
 * and custom receipt header/footer.
 */
export interface ReceiptBranchInfo {
  name: string | null;           // Arabic name
  nameEn: string | null;         // English name
  phone: string | null;
  address: string | null;
  addressEn: string | null;
  vatNumber: string | null;      // If set, overrides global taxNumber
  logo: string | null;           // base64 data URL — overrides global logo
  taxRate: number | null;        // If set (e.g. 15), overrides the hardcoded 15%
  receiptHeader: string | null;  // Custom text shown above the items
  receiptFooter: string | null;  // Custom text shown in the footer
}

export interface ReceiptPrintSettings {
  receiptWidth: number;
  fontSize: number;
  logoWidth: number;
  logoHeight: number;
}

// ─── Constants ──────────────────────────────────────────────────

const BRANCH_ENGLISH_NAMES: Record<string, string> = {
  CHINA_TOWN: 'CHINA TOWN',
  PALACE_INDIA: 'PALACE INDIA',
};

const BRANCH_ARABIC_NAMES: Record<string, string> = {
  CHINA_TOWN: 'تشاينا تاون',
  PALACE_INDIA: 'بالاس الهند',
};

const PAYMENT_METHOD_BILINGUAL: Record<string, string> = {
  CASH: 'نقدي / Cash',
  CREDIT: 'آجل / Credit',
  MADA: 'مدى / Mada',
  VISA: 'فيزا / Visa',
  MASTERCARD: 'ماستركارد / Mastercard',
  OTHER_CARD: 'بطاقة أخرى / Other Card',
  SADAD: 'سداد / Sadad',
  TRANSFER: 'تحويل / Transfer',
};

// ─── QR Code Generation (server-side safe) ──────────────────────

let qrCodeModule: any = null;

async function generateQRCodeDataUrl(data: string): Promise<string> {
  try {
    if (!qrCodeModule) {
      qrCodeModule = await import('qrcode');
    }
    return await qrCodeModule.toDataURL(data, {
      width: 160,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}

// ─── Payment Status Text ────────────────────────────────────────

function getPaymentStatusText(payments: ReceiptPaymentData[]): { text: string; isPaid: boolean } {
  if (payments.length === 0) return { text: 'مدفوع / Paid', isPaid: true };
  const hasCredit = payments.some(p => p.method === 'CREDIT');
  if (hasCredit) return { text: 'آجل / Unpaid', isPaid: false };
  return { text: 'مدفوع / Paid', isPaid: true };
}

// ─── Date/Time Formatters ───────────────────────────────────────

function formatReceiptDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatReceiptTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

// ─── Currency Formatter (returns HTML string — always shows currency) ────

function receiptCurrency(amount: number, currencySymbolUrl?: string): string {
  const formatted = formatNumber(amount);
  if (currencySymbolUrl) {
    return `<span class="amount-num">${formatted}</span> <img src="${currencySymbolUrl}" alt="ر.س" style="width:11px;height:11px;object-fit:contain;vertical-align:middle;display:inline;" />`;
  }
  return `<span class="amount-num">${formatted}</span> <span class="currency-text">ر.س</span>`;
}

// ─── Generate Receipt Content HTML ──────────────────────────────

export function generateReceiptContentHtml(params: {
  invoice: ReceiptInvoiceData;
  companyInfo: ReceiptCompanyInfo;
  branchInfo?: ReceiptBranchInfo | null;
  logoDataUrl: string;
  qrCodeDataUrl: string;
  currencySymbolUrl: string;
  printSettings: ReceiptPrintSettings;
  finalized: boolean;
}): string {
  const { invoice, companyInfo, branchInfo, logoDataUrl, qrCodeDataUrl, currencySymbolUrl, printSettings, finalized } = params;
  const isReturn = invoice.isReturn;

  // ─── Resolve effective values: branch overrides take precedence over global ───
  // Each branch holds its OWN independent settings (logo, name, phone, address,
  // VAT number, tax rate, receipt header/footer). When a branch value is set
  // (non-null), it overrides the corresponding global company setting.
  const effectiveLogo = branchInfo?.logo || logoDataUrl;
  const effectiveCompanyName = branchInfo?.name || companyInfo.companyName;
  const effectiveCompanyNameEn = branchInfo?.nameEn || companyInfo.companyNameEn;
  const effectivePhone = branchInfo?.phone || companyInfo.phone;
  const effectiveAddress = branchInfo?.address || companyInfo.address;
  const effectiveAddressEn = branchInfo?.addressEn || companyInfo.addressEn;
  const effectiveTaxNumber = branchInfo?.vatNumber || companyInfo.taxNumber;
  const effectiveTaxRate = branchInfo?.taxRate !== null && branchInfo?.taxRate !== undefined
    ? branchInfo.taxRate
    : 15; // default 15% if neither branch nor global override is set
  const branchReceiptHeader = branchInfo?.receiptHeader || '';
  const branchReceiptFooter = branchInfo?.receiptFooter || '';

  // Branch display names (prefer the branch record's name/nameEn; fall back to
  // the legacy hardcoded maps only if branchInfo is unavailable)
  const branchNameAr = branchInfo?.name || BRANCH_ARABIC_NAMES[invoice.branch] || invoice.branch;
  const branchNameEn = branchInfo?.nameEn || BRANCH_ENGLISH_NAMES[invoice.branch] || invoice.branch;

  // ─── Items Table Rows (4 columns: Item | Qty | Price | Amount) ───
  const itemsRows = (invoice.items || []).map((item) => {
    const itemNameEn = item.nameEn || '';
    return `
      <tr>
        <td class="item-name-cell">
          <span class="item-name-ar">${sanitizeHtml(item.name)}</span>
          ${itemNameEn ? `<span class="item-name-en">${sanitizeHtml(itemNameEn)}</span>` : ''}
        </td>
        <td class="item-qty-cell">${item.quantity}</td>
        <td class="item-unitprice-cell" dir="ltr">${receiptCurrency(item.unitPrice, currencySymbolUrl)}</td>
        <td class="item-total-cell" dir="ltr">${receiptCurrency(item.totalPrice, currencySymbolUrl)}</td>
      </tr>
    `;
  }).join('');

  // ─── Payment Lines ───
  const paymentsHtml = (invoice.payments || []).map((p) => {
    const methodLabel = PAYMENT_METHOD_BILINGUAL[p.method] || PAYMENT_METHOD_LABELS[p.method as PaymentMethod] || p.method;
    return `<div class="payment-line"><span>${methodLabel}</span><span dir="ltr">${receiptCurrency(p.amount, currencySymbolUrl)}</span></div>`;
  }).join('');

  // ─── Discount Line ───
  const discountLine = invoice.discountAmount > 0
    ? `<div class="totals-row discount"><span>خصم ${invoice.discountPercentage}% / Discount ${invoice.discountPercentage}%</span><span dir="ltr">-${receiptCurrency(invoice.discountAmount, currencySymbolUrl)}</span></div>`
    : '';

  // ─── Payment Status ───
  const paymentStatus = getPaymentStatusText(invoice.payments);
  const statusClass = paymentStatus.isPaid ? 'status-paid' : 'status-unpaid';

  // ─── Change Line ───
  const changeLine = (invoice.changeAmount ?? 0) > 0
    ? `<div class="change-line">الباقي / Change: <span dir="ltr">${receiptCurrency(invoice.changeAmount, currencySymbolUrl)}</span></div>`
    : '';

  // ─── Address Lines (use effective per-branch address if set) ───
  const addressArLine = effectiveAddress
    ? `<div class="center company-address">${sanitizeHtml(effectiveAddress)}</div>`
    : '';
  const addressEnLine = effectiveAddressEn
    ? `<div class="center company-address-en">${sanitizeHtml(effectiveAddressEn)}</div>`
    : '';

  // ─── Customer Phone ───
  const customerPhoneLine = invoice.customerPhone
    ? `<div class="info-row"><span>هاتف العميل / Phone</span><span dir="ltr">${sanitizeHtml(invoice.customerPhone)}</span></div>`
    : '';

  // ─── Branch receipt header (custom text above items) ───
  const receiptHeaderLine = branchReceiptHeader
    ? `<div class="center branch-header">${sanitizeHtml(branchReceiptHeader)}</div><div class="separator"></div>`
    : '';

  // ─── Branch receipt footer (custom text in footer) ───
  const receiptFooterLine = branchReceiptFooter
    ? `<div class="footer-custom">${sanitizeHtml(branchReceiptFooter)}</div>`
    : '';

  // Format the effective tax rate for display (strip trailing zeros)
  const taxRateDisplay = Number.isInteger(effectiveTaxRate)
    ? String(effectiveTaxRate)
    : effectiveTaxRate.toFixed(2).replace(/\.?0+$/, '');

  return `
    <div class="receipt">

      <!-- ═══════════ HEADER ═══════════ -->
      ${effectiveLogo ? `<div class="center" style="margin-bottom:6px;"><img class="logo" src="${effectiveLogo}" alt="شعار / Logo" /></div>` : ''}

      <div class="center">
        <div class="company-name">${sanitizeHtml(effectiveCompanyName) || 'المطعم'}</div>
        <div class="company-name-en">${sanitizeHtml(effectiveCompanyNameEn) || 'Restaurant'}</div>
      </div>

      ${effectiveTaxNumber ? `<div class="center"><div class="company-info">الرقم الضريبي / VAT No.: <span dir="ltr">${sanitizeHtml(effectiveTaxNumber)}</span></div></div>` : ''}

      ${addressArLine}
      ${addressEnLine}

      <div class="separator"></div>

      <!-- ═══════════ RETURN BADGE ═══════════ -->
      ${isReturn ? `
        <div class="center bold return-badge">※ مرتجع / RETURN ※</div>
        <div class="separator"></div>
      ` : ''}

      <!-- ═══════════ BRANCH & CONTACT ═══════════ -->
      <div class="info-row"><span>الفرع / Branch</span><span>${sanitizeHtml(branchNameAr)} / ${sanitizeHtml(branchNameEn)}</span></div>
      ${effectivePhone ? `<div class="info-row"><span>هاتف / Phone</span><span dir="ltr">${sanitizeHtml(effectivePhone)}</span></div>` : ''}

      <div class="separator"></div>

      <!-- ═══════════ INVOICE INFO ═══════════ -->
      <div class="info-row"><span>فاتورة / Invoice</span><span class="bold" dir="ltr">${sanitizeHtml(invoice.invoiceNumber)}</span></div>
      <div class="info-row"><span>التاريخ / Date</span><span dir="ltr">${formatReceiptDate(invoice.createdAt)}</span></div>
      <div class="info-row"><span>الوقت / Time</span><span dir="ltr">${formatReceiptTime(invoice.createdAt)}</span></div>
      ${invoice.table?.name ? `<div class="info-row"><span>الطاولة / Table</span><span>${sanitizeHtml(invoice.table.name)}</span></div>` : ''}
      <div class="info-row"><span>العميل / Customer</span><span>${sanitizeHtml(invoice.customerName) || 'عميل نقدي / Cash'}</span></div>
      ${customerPhoneLine}

      ${receiptHeaderLine}

      <div class="double-separator"></div>

      <!-- ═══════════ ITEMS TABLE ═══════════ -->
      <table class="items-table">
        <thead>
          <tr>
            <th>الصنف<br/><span class="th-en">Item</span></th>
            <th>الكمية<br/><span class="th-en">Qty</span></th>
            <th>السعر<br/><span class="th-en">Price</span></th>
            <th>المبلغ<br/><span class="th-en">Amount</span></th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>

      <div class="double-separator"></div>

      <!-- ═══════════ FINANCIAL SUMMARY ═══════════ -->
      <div class="totals-row"><span>المجموع الفرعي / Subtotal</span><span dir="ltr">${receiptCurrency(invoice.subtotal, currencySymbolUrl)}</span></div>
      ${discountLine}
      <div class="totals-row"><span>ضريبة القيمة المضافة ${taxRateDisplay}%<br/><span class="tax-sub-label">VAT ${taxRateDisplay}%</span></span><span dir="ltr">${receiptCurrency(invoice.taxAmount, currencySymbolUrl)}</span></div>

      <div class="total-box">
        <div class="totals-row total-row">
          <span>الإجمالي / TOTAL</span>
          <span dir="ltr">${receiptCurrency(invoice.totalAmount, currencySymbolUrl)}</span>
        </div>
      </div>

      <div class="single-separator"></div>

      <!-- ═══════════ PAYMENT SECTION ═══════════ -->
      <div class="payment-header">طريقة الدفع / Payment Method</div>
      ${paymentsHtml}

      <div class="totals-row"><span>المدفوع / Paid</span><span dir="ltr">${receiptCurrency(invoice.paidAmount, currencySymbolUrl)}</span></div>

      <div class="status-line ${statusClass}"><span>حالة الدفع / Status</span><span>${paymentStatus.text}</span></div>

      ${changeLine}

      <div class="separator"></div>

      <!-- ═══════════ QR CODE SECTION ═══════════ -->
      ${qrCodeDataUrl ? `
        <div class="qr-section">
          <div class="qr-code"><img src="${qrCodeDataUrl}" alt="رمز الاستجابة السريعة / QR Code" /></div>
          <div class="qr-hint">امسح رمز QR للتحقق / Scan QR to verify</div>
        </div>
      ` : ''}

      ${effectiveTaxNumber ? `
        <div class="vat-label">
          فاتورة ضريبية - الرقم الضريبي: <span dir="ltr">${sanitizeHtml(effectiveTaxNumber)}</span><br/>
          Tax Invoice - VAT No.: <span dir="ltr">${sanitizeHtml(effectiveTaxNumber)}</span>
        </div>
      ` : ''}

      <!-- ═══════════ FOOTER ═══════════ -->
      <div class="footer">
        <div class="footer-thanks">شكراً لزيارتكم</div>
        <div class="footer-thanks-en">Thank you for visiting</div>
        ${receiptFooterLine}
      </div>

      ${!finalized ? `<div class="not-posted">※ معاينة - لم يتم الترحيل بعد / Preview - Not yet posted ※</div>` : ''}
    </div>
  `;
}

// ─── Generate Receipt CSS ───────────────────────────────────────

export function generateReceiptCss(printSettings: ReceiptPrintSettings): string {
  const rw = printSettings.receiptWidth;
  const fs = printSettings.fontSize;
  const lw = printSettings.logoWidth;
  const lh = printSettings.logoHeight;
  // Usable content width = receipt width minus left/right margins (4mm each)
  // For 80mm paper, that's 72mm of printable area

  return `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      width: ${rw}mm;
      margin: 0 auto;
      padding: 4mm;
      font-size: ${fs}px;
      line-height: 1.6;
      font-weight: 700;
      color: #000;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ─── Base Layout ─── */
    .receipt { width: 100%; direction: rtl; }
    .center { text-align: center; }
    .bold { font-weight: 700; }

    /* ─── Separators ─── */
    .separator { border-top: 1px dashed #000; margin: 4px 0; }
    .single-separator { border-top: 1px solid #000; margin: 4px 0; }
    .double-separator { border-top: 2px solid #000; margin: 5px 0; }

    /* ─── Logo ─── */
    .logo {
      max-width: 40mm;
      width: ${lw}mm;
      height: ${lh}mm;
      margin: 0 auto 6px;
      display: block;
      object-fit: contain;
    }

    /* ─── Header ─── */
    .company-name {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: 0.3px;
    }
    .company-name-en {
      font-size: 12px;
      font-weight: 700;
      color: #000;
      line-height: 1.4;
      direction: ltr;
      margin-top: 1px;
    }
    .company-address {
      font-size: 9px;
      color: #000;
      line-height: 1.3;
      margin-top: 2px;
    }
    .company-address-en {
      font-size: 9px;
      color: #000;
      line-height: 1.3;
      direction: ltr;
    }
    .company-info {
      font-size: 9px;
      color: #000;
      line-height: 1.4;
      margin-top: 2px;
    }

    /* ─── Return Badge ─── */
    .return-badge {
      font-size: 14px;
      color: #c00;
      padding: 2px 0;
      letter-spacing: 1px;
    }

    /* ─── Info Rows ─── */
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.5;
    }
    .info-row span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /* ─── Items Table ─── */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .items-table thead th {
      font-weight: 700;
      font-size: 10px;
      padding: 3px 1px;
      text-align: right;
      border-bottom: 1px solid #000;
      line-height: 1.3;
    }
    .items-table thead th .th-en {
      display: block;
      font-weight: 700;
      font-size: 8px;
      color: #000;
      direction: ltr;
      text-align: inherit;
    }
    .items-table thead th:nth-child(2) {
      text-align: center;
      width: 10%;
    }
    .items-table thead th:nth-child(3) {
      text-align: center;
      direction: ltr;
      width: 25%;
    }
    .items-table thead th:nth-child(3) .th-en {
      text-align: center;
    }
    .items-table thead th:nth-child(4) {
      text-align: center;
      direction: ltr;
      width: 25%;
    }
    .items-table thead th:nth-child(4) .th-en {
      text-align: center;
    }

    .items-table tbody td {
      padding: 3px 1px;
      vertical-align: top;
      line-height: 1.3;
    }
    .items-table tbody tr {
      border-bottom: 1px dotted #ccc;
    }
    .items-table tbody tr:last-child {
      border-bottom: none;
    }

    /* Item Name Cell */
    .item-name-cell {
      text-align: right;
      width: 40%;
    }
    .item-name-ar {
      font-weight: 700;
      font-size: 11px;
    }
    .item-name-en {
      display: block;
      font-size: 8px;
      color: #000;
      direction: ltr;
      text-align: left;
      unicode-bidi: plaintext;
      margin-top: 1px;
    }

    /* Qty Cell */
    .item-qty-cell {
      text-align: center;
      direction: ltr;
      unicode-bidi: isolate;
      white-space: nowrap;
      width: 10%;
    }

    /* Unit Price Cell */
    .item-unitprice-cell {
      text-align: center;
      white-space: nowrap;
      width: 25%;
      font-size: 10px;
    }

    /* Total Price Cell */
    .item-total-cell {
      text-align: center;
      white-space: nowrap;
      width: 25%;
      font-weight: 700;
    }

    /* ─── Totals Rows ─── */
    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 2px 0;
      font-size: 11px;
      line-height: 1.5;
    }
    .totals-row span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }
    .totals-row.discount {
      color: #c00;
      font-weight: 700;
    }
    .tax-sub-label {
      font-size: 8px;
      color: #000;
      direction: ltr;
      display: inline;
    }

    /* ─── Total Box (prominent) ─── */
    .total-box {
      border: 2px solid #000;
      padding: 4px 6px;
      margin: 4px 0;
      background-color: #f5f5f5;
    }
    .total-row {
      font-size: 15px;
      font-weight: 700;
      padding: 0;
    }
    .total-row span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /* ─── Currency & Amounts ─── */
    .amount-num {
      font-feature-settings: 'tnum';
      font-variant-numeric: tabular-nums;
    }
    .currency-text {
      font-size: 10px;
      font-weight: 700;
      color: #000;
    }

    /* ─── Payment Section ─── */
    .payment-header {
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 3px;
      padding-bottom: 2px;
      border-bottom: 1px solid #000;
    }
    .payment-line {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
      font-size: 11px;
      font-weight: 700;
    }
    .payment-line span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /* ─── Payment Status ─── */
    .status-line {
      display: flex;
      justify-content: space-between;
      padding: 3px 6px;
      font-size: 11px;
      font-weight: 700;
      border: 1.5px solid #000;
      margin: 4px 0;
    }
    .status-paid {
      background-color: #e8f5e9;
      color: #1b5e20;
      border-color: #2e7d32;
    }
    .status-unpaid {
      background-color: #fff3e0;
      color: #bf360c;
      border-color: #e65100;
    }

    /* ─── Change Line ─── */
    .change-line {
      font-weight: 700;
      font-size: 13px;
      text-align: center;
      padding: 4px 0;
      border: 1.5px solid #000;
      margin: 4px 0;
    }
    .change-line span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /* ─── QR Code Section ─── */
    .qr-section {
      text-align: center;
      margin: 4px 0;
    }
    .qr-code {
      text-align: center;
      margin: 0 auto;
    }
    .qr-code img {
      width: 30mm;
      height: 30mm;
    }
    .qr-hint {
      font-size: 8px;
      color: #000;
      margin-top: 3px;
      direction: rtl;
    }

    /* ─── VAT Label ─── */
    .vat-label {
      font-size: 8px;
      color: #000;
      text-align: center;
      margin-top: 3px;
      line-height: 1.4;
    }
    .vat-label span[dir="ltr"] {
      direction: ltr;
      unicode-bidi: isolate;
    }

    /* ─── Footer ─── */
    .footer {
      text-align: center;
      margin-top: 6px;
      padding-top: 4px;
    }
    .footer-thanks {
      font-size: 14px;
      font-weight: 700;
      color: #000;
      line-height: 1.4;
    }
    .footer-thanks-en {
      font-size: 11px;
      font-weight: 700;
      color: #000;
      line-height: 1.4;
      direction: ltr;
    }
    .footer-custom {
      font-size: 11px;
      font-weight: 700;
      color: #000;
      line-height: 1.4;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px dashed #000;
    }

    /* ─── Branch Receipt Header (custom text above items) ─── */
    .branch-header {
      font-size: 12px;
      font-weight: 700;
      color: #000;
      line-height: 1.4;
      margin-top: 4px;
      padding: 4px 0;
    }

    /* ─── Preview Badge ─── */
    .not-posted {
      text-align: center;
      font-size: 10px;
      color: #c00;
      margin-top: 6px;
      border: 1.5px dashed #c00;
      padding: 3px;
      font-weight: 700;
    }

    /* ─── Monospace for numbers/English ─── */
    .amount-num, .item-qty-cell, .item-unitprice-cell, .item-total-cell, [dir="ltr"] {
      font-family: 'Roboto Mono', 'Courier New', monospace;
    }

    /* ─── Print Styles ─── */
    @media print {
      body {
        width: ${rw}mm;
        margin: 0;
        padding: 3mm;
      }
      .total-box {
        background-color: transparent !important;
      }
      .status-paid, .status-unpaid {
        background-color: transparent !important;
      }
      @page {
        margin: 0;
        size: ${rw}mm auto;
      }
    }
  `;
}

// ─── Generate Complete Print-Ready HTML ─────────────────────────

export function generateCompleteReceiptHtml(params: {
  invoice: ReceiptInvoiceData;
  companyInfo: ReceiptCompanyInfo;
  branchInfo?: ReceiptBranchInfo | null;
  logoDataUrl: string;
  qrCodeDataUrl: string;
  currencySymbolUrl: string;
  printSettings: ReceiptPrintSettings;
  finalized: boolean;
}): string {
  const content = generateReceiptContentHtml(params);
  const css = generateReceiptCss(params.printSettings);
  const rw = params.printSettings.receiptWidth;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${rw}mm">
  <title>إيصال ${params.invoice.invoiceNumber}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Roboto+Mono:wght@400;500;700&display=swap">
  <style>${css}</style>
</head>
<body>${content}</body>
</html>`;
}

// ─── Generate QR Code Content String ───────────────────────────

export function generateQrContent(
  invoice: ReceiptInvoiceData,
  companyInfo: ReceiptCompanyInfo,
  branchInfo?: ReceiptBranchInfo | null
): string {
  // Use branch overrides for seller name and VAT number when available
  const sellerName = sanitizeHtml(branchInfo?.name || companyInfo.companyName) || 'المطعم';
  const vatNumber = sanitizeHtml(branchInfo?.vatNumber || companyInfo.taxNumber) || '';
  const totalAmount = formatNumber(invoice.totalAmount);
  const vatAmount = formatNumber(invoice.taxAmount);
  const timestamp = new Date(invoice.createdAt).toISOString();

  return generateZatcaQR({
    sellerName,
    vatNumber,
    timestamp,
    totalAmount,
    vatAmount,
  });
}

// ─── Generate and return QR data URL ────────────────────────────

export async function generateQrCodeDataUrl(
  invoice: ReceiptInvoiceData,
  companyInfo: ReceiptCompanyInfo,
  branchInfo?: ReceiptBranchInfo | null
): Promise<string> {
  const qrContent = generateQrContent(invoice, companyInfo, branchInfo);
  return generateQRCodeDataUrl(qrContent);
}
