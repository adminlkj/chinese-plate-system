import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess } from '@/lib/api-auth';
import { getEffectiveTaxRate } from '@/lib/branch-resolver';

// Helper: recalculate invoice totals after item changes.
// Uses percentage-based discount calculation (consistent with PUT handler and items/route.ts).
// Uses the per-branch tax rate override (branch.taxRate) when set.
async function recalcInvoiceTotals(tx: any, invoiceId: string) {
  const items = await tx.pOSInvoiceItem.findMany({
    where: { invoiceId },
    orderBy: { sortOrder: 'asc' },
  });

  const subtotal = items.reduce((sum: number, item: any) => sum + toNumber(item.totalPrice), 0);
  const invoice = await tx.pOSInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;

  // Use percentage-based discount (same logic as PUT handler and items/route.ts)
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

// PUT /api/pos/invoices/[id]/items/[itemId] - Update a specific item
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id, itemId } = await params;
    const body = await request.json();
    const { name, quantity, unitPrice, notes, productId } = body;

    const existing = await db.pOSInvoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
    }
    if (existing.status !== 'DRAFT' && auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'لا يمكن تعديل فاتورة غير مسودة - فقط مدير النظام يمكنه ذلك' }, { status: 400 });
    }

    const item = await db.pOSInvoiceItem.findUnique({ where: { id: itemId } });
    if (!item || item.invoiceId !== id) {
      return NextResponse.json({ error: 'الصنف غير موجود في هذه الفاتورة' }, { status: 404 });
    }

    const newQty = quantity ?? toNumber(item.quantity);
    const newPrice = unitPrice ?? toNumber(item.unitPrice);
    const totalPrice = newQty * newPrice;

    const invoice = await db.$transaction(async (tx) => {
      await tx.pOSInvoiceItem.update({
        where: { id: itemId },
        data: {
          ...(name !== undefined && { name }),
          ...(productId !== undefined && { productId }),
          quantity: newQty,
          unitPrice: newPrice,
          totalPrice,
          ...(notes !== undefined && { notes }),
        },
      });

      return recalcInvoiceTotals(tx, id);
    });

    if (!invoice) {
      return NextResponse.json({ error: 'فشل في تحديث الفاتورة' }, { status: 500 });
    }

    return NextResponse.json(formatInvoice(invoice));
  } catch (error: any) {
    console.error('Error updating item:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث الصنف' },
      { status: 500 }
    );
  }
}

// DELETE /api/pos/invoices/[id]/items/[itemId] - Delete a specific item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id, itemId } = await params;

    const existing = await db.pOSInvoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
    }
    if (existing.status !== 'DRAFT' && auth.role !== 'ADMIN') {
      return NextResponse.json({ error: 'لا يمكن تعديل فاتورة غير مسودة - فقط مدير النظام يمكنه ذلك' }, { status: 400 });
    }

    const item = await db.pOSInvoiceItem.findUnique({ where: { id: itemId } });
    if (!item || item.invoiceId !== id) {
      return NextResponse.json({ error: 'الصنف غير موجود في هذه الفاتورة' }, { status: 404 });
    }

    const invoice = await db.$transaction(async (tx) => {
      await tx.pOSInvoiceItem.delete({ where: { id: itemId } });
      return recalcInvoiceTotals(tx, id);
    });

    if (!invoice) {
      return NextResponse.json({ error: 'فشل في تحديث الفاتورة' }, { status: 500 });
    }

    return NextResponse.json(formatInvoice(invoice));
  } catch (error: any) {
    console.error('Error deleting item:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الصنف' },
      { status: 500 }
    );
  }
}
