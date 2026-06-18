import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { getEffectiveTaxRate } from '@/lib/branch-resolver';

// Helper: recalculate invoice totals after item changes.
// Uses the per-branch tax rate override (branch.taxRate) when set; otherwise
// falls back to the global taxRate setting, then to 0.15 (15%).
async function recalcInvoiceTotals(tx: any, invoiceId: string) {
  const items = await tx.pOSInvoiceItem.findMany({
    where: { invoiceId },
    orderBy: { sortOrder: 'asc' },
  });

  const subtotal = items.reduce((sum: number, item: any) => sum + toNumber(item.totalPrice), 0);
  const invoice = await tx.pOSInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;

  const discountPct = toNumber(invoice.discountPercentage) || 0;
  const discountAmount = Math.round(subtotal * (discountPct / 100) * 100) / 100;
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const globalTaxRateSetting = await db.setting.findUnique({ where: { key: 'taxRate' } });
  const effectiveTaxRate = await getEffectiveTaxRate(invoice.branchId, globalTaxRateSetting?.value ?? null);
  const taxAmount = Math.round(taxableAmount * effectiveTaxRate * 100) / 100;
  const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

  return tx.pOSInvoice.update({
    where: { id: invoiceId },
    data: { subtotal, discountAmount, taxAmount, totalAmount },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      customer: { select: { id: true, name: true, phone: true } },
      table: { select: { id: true, name: true } },
    },
  });
}

// Helper: format invoice for response
function formatInvoice(invoice: any) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    tableId: invoice.tableId,
    table: invoice.table,
    branchId: invoice.branchId,
    status: invoice.status,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    customer: invoice.customer,
    subtotal: toNumber(invoice.subtotal),
    discountPercentage: toNumber(invoice.discountPercentage),
    discountAmount: toNumber(invoice.discountAmount),
    taxAmount: toNumber(invoice.taxAmount),
    totalAmount: toNumber(invoice.totalAmount),
    paymentMethod: invoice.paymentMethod,
    transactionId: invoice.transactionId,
    notes: invoice.notes,
    items: invoice.items.map((item: any) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      productId: item.productId,
      name: item.name,
      nameEn: item.nameEn || null,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice),
      notes: item.notes,
      sortOrder: item.sortOrder,
    })),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

// POST /api/pos/invoices/[id]/items - Add a new item to an invoice
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const { name, nameEn, unitPrice, quantity, notes, productId } = body;

    const existing = await db.pOSInvoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
    }
    if (existing.status !== 'DRAFT' && auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'لا يمكن تعديل فاتورة غير مسودة - فقط مدير النظام يمكنه ذلك' }, { status: 400 });
    }

    const itemQty = quantity ?? 1;
    const itemPrice = unitPrice ?? 0;

    if (itemQty <= 0) {
      return NextResponse.json({ error: 'الكمية يجب أن تكون أكبر من صفر / Quantity must be positive' }, { status: 400 });
    }
    if (itemPrice < 0) {
      return NextResponse.json({ error: 'سعر الوحدة لا يمكن أن يكون سالباً / Unit price cannot be negative' }, { status: 400 });
    }

    const invoice = await db.$transaction(async (tx) => {
      // If productId is provided, check if an item with the same productId already exists in the invoice
      // If so, increment the quantity instead of creating a new row
      if (productId) {
        const existingItem = await tx.pOSInvoiceItem.findFirst({
          where: { invoiceId: id, productId },
        });

        if (existingItem) {
          // Increment quantity and recalculate totalPrice
          const newQty = toNumber(existingItem.quantity) + itemQty;
          const newTotalPrice = newQty * itemPrice;

          await tx.pOSInvoiceItem.update({
            where: { id: existingItem.id },
            data: {
              quantity: newQty,
              unitPrice: itemPrice,
              totalPrice: newTotalPrice,
            },
          });

          return recalcInvoiceTotals(tx, id);
        }
      }

      // No existing item with same productId — create a new item
      // If productId is provided, look up the English name from the Product table
      let resolvedNameEn = nameEn || null;
      if (productId && !resolvedNameEn) {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { nameEn: true },
        });
        resolvedNameEn = product?.nameEn || null;
      }

      // Get next sort order
      const maxSort = await tx.pOSInvoiceItem.findFirst({
        where: { invoiceId: id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      const totalPrice = itemQty * itemPrice;

      await tx.pOSInvoiceItem.create({
        data: {
          name: name || 'عنصر',
          nameEn: resolvedNameEn,
          productId: productId || null,
          quantity: itemQty,
          unitPrice: itemPrice,
          totalPrice,
          notes: notes || null,
          sortOrder: (maxSort?.sortOrder ?? -1) + 1,
          invoiceId: id,
        },
      });

      return recalcInvoiceTotals(tx, id);
    });

    if (!invoice) {
      return NextResponse.json({ error: 'فشل في تحديث الفاتورة' }, { status: 500 });
    }

    return NextResponse.json(formatInvoice(invoice));
  } catch (error: any) {
    console.error('Error adding item:', error);
    return NextResponse.json(
      { error: 'فشل في إضافة الصنف' },
      { status: 500 }
    );
  }
}
