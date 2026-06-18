import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkReadAccess } from '@/lib/api-auth';
import {
  generateCompleteReceiptHtml,
  generateQrCodeDataUrl,
  type ReceiptInvoiceData,
  type ReceiptCompanyInfo,
  type ReceiptBranchInfo,
  type ReceiptPrintSettings,
} from '@/lib/receipt-template';

// GET /api/pos/invoices/[id]/receipt
// Generates a complete, unified receipt HTML for any invoice.
// This is the SINGLE SOURCE OF TRUTH for receipt generation.
// All printing locations (POS, Sales Invoices, Returns, Daily Report)
// should call this API to ensure consistent receipt format.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos');
    if (!readCheck.authenticated) return readCheck.response;

    const { id } = await params;

    // ─── 1. Fetch invoice with full details ───
    const invoice = await db.pOSInvoice.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        customer: { select: { id: true, name: true, phone: true } },
        table: { select: { id: true, name: true } },
        originalInvoice: { select: { invoiceNumber: true } },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    // ─── 2. Fetch company info from settings (global defaults) ───
    const settingKeys = [
      'companyName', 'companyNameEn', 'taxNumber',
      'phone', 'address', 'addressEn',
      'currencySymbolImage',
      'receiptWidth', 'fontSize', 'logoWidth', 'logoHeight',
    ];

    const settings = await db.setting.findMany({
      where: { key: { in: settingKeys } },
    });

    const getSetting = (key: string, fallback: string = ''): string => {
      const s = settings.find(s => s.key === key);
      return s?.value || fallback;
    };

    const companyInfo: ReceiptCompanyInfo = {
      companyName: getSetting('companyName', 'المطعم'),
      companyNameEn: getSetting('companyNameEn', 'Restaurant'),
      taxNumber: getSetting('taxNumber'),
      address: getSetting('address'),
      addressEn: getSetting('addressEn'),
      phone: getSetting('phone'),
    };

    const printSettings: ReceiptPrintSettings = {
      receiptWidth: parseFloat(getSetting('receiptWidth', '80')),
      fontSize: parseFloat(getSetting('fontSize', '12')),
      logoWidth: parseFloat(getSetting('logoWidth', '30')),
      logoHeight: parseFloat(getSetting('logoHeight', '30')),
    };

    // ─── 3. Fetch the Branch record — each branch holds its OWN independent ───
    // ─── settings (logo, name, phone, address, VAT, taxRate, header/footer). ───
    // These OVERRIDE the global companyInfo when present.
    const branch = await db.branch.findUnique({
      where: { id: invoice.branchId },
    });

    const branchInfo: ReceiptBranchInfo | null = branch
      ? {
          name: branch.name,
          nameEn: branch.nameEn,
          phone: branch.phone,
          address: branch.address,
          addressEn: branch.addressEn,
          vatNumber: branch.vatNumber,
          logo: branch.logo,
          taxRate:
            branch.taxRate !== null && branch.taxRate !== undefined
              ? toNumber(branch.taxRate)
              : null,
          receiptHeader: branch.receiptHeader,
          receiptFooter: branch.receiptFooter,
        }
      : null;

    // ─── 4. Logo: prefer Branch.logo; fall back to legacy Setting-based logo ───
    let logoDataUrl = branchInfo?.logo || '';
    if (!logoDataUrl) {
      // Legacy fallback: setting key may be keyed by branchId (UUID) or branch code
      let branchCodeForLogo: string | null = invoice.branchId;
      if (branch?.code) branchCodeForLogo = branch.code;
      const logoKey = `logo_${branchCodeForLogo}`;
      const logoSetting = await db.setting.findUnique({ where: { key: logoKey } });
      logoDataUrl = logoSetting?.value || '';
    }

    // ─── 5. Fetch currency symbol ───
    const currencySymbolUrl = getSetting('currencySymbolImage');

    // ─── 5. Build receipt invoice data ───
    const receiptInvoice: ReceiptInvoiceData = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      branch: invoice.branchId,
      status: invoice.status,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      customerPhone: invoice.customer?.phone || null,
      subtotal: toNumber(invoice.subtotal),
      discountPercentage: toNumber(invoice.discountPercentage),
      discountAmount: toNumber(invoice.discountAmount),
      taxAmount: toNumber(invoice.taxAmount),
      totalAmount: toNumber(invoice.totalAmount),
      paidAmount: toNumber(invoice.paidAmount),
      changeAmount: toNumber(invoice.changeAmount),
      paymentMethod: invoice.paymentMethod,
      isReturn: invoice.isReturn,
      originalInvoiceNumber: (invoice as any).originalInvoice?.invoiceNumber ?? null,
      table: invoice.table ? { id: invoice.table.id, name: invoice.table.name } : null,
      items: invoice.items.map(item => ({
        id: item.id,
        name: item.name,
        nameEn: item.nameEn,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        totalPrice: toNumber(item.totalPrice),
        productId: item.productId,
      })),
      payments: invoice.payments.map(p => ({
        id: p.id,
        method: p.method,
        amount: toNumber(p.amount),
      })),
      createdAt: invoice.createdAt.toISOString(),
    };

    // ─── 6. Generate QR code (uses branch overrides for seller name + VAT) ───
    const qrCodeDataUrl = await generateQrCodeDataUrl(receiptInvoice, companyInfo, branchInfo);

    // ─── 7. Generate complete receipt HTML using the unified template ───
    // Pass branchInfo so the receipt shows the branch's own logo, name, phone,
    // address, VAT, tax rate, and custom header/footer.
    const finalized = invoice.status === 'FINALIZED' || invoice.status === 'RETURNED';
    const receiptHtml = generateCompleteReceiptHtml({
      invoice: receiptInvoice,
      companyInfo,
      branchInfo,
      logoDataUrl,
      qrCodeDataUrl,
      currencySymbolUrl,
      printSettings,
      finalized,
    });

    // ─── 8. Return the receipt HTML ───
    // Also return a flag indicating if this should be saved to DB
    return new NextResponse(receiptHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Receipt-Should-Save': (!invoice.receiptHtml && finalized) ? 'true' : 'false',
      },
    });
  } catch (error: any) {
    console.error('Error generating receipt:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الإيصال' },
      { status: 500 }
    );
  }
}
