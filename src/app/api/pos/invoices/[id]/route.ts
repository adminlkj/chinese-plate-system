import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, requireRole, checkWriteAccess, checkReadAccess } from '@/lib/api-auth';
import { updateAccountBalance } from '@/lib/accounting-engine';
import { getEffectiveTaxRate } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// Helper: format invoice for response (converts all Decimal fields to number)
function formatInvoice(invoice: any) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    tableId: invoice.tableId,
    tableName: invoice.table?.name,
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
    paidAmount: toNumber(invoice.paidAmount),
    changeAmount: toNumber(invoice.changeAmount),
    paymentMethod: invoice.paymentMethod,
    transactionId: invoice.transactionId,
    transaction: invoice.transaction
      ? {
          ...invoice.transaction,
          netAmount: toNumber(invoice.transaction.netAmount),
        }
      : undefined,
    receiptHtml: invoice.receiptHtml || null,
    notes: invoice.notes,
    items: invoice.items?.map((item: any) => ({
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
    })) || [],
    payments: invoice.payments?.map((p: any) => ({
      ...p,
      amount: toNumber(p.amount),
    })) || [],
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

// GET /api/pos/invoices/[id] - Get invoice by ID with full details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const { id } = await params;

    const invoice = await db.pOSInvoice.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        customer: { select: { id: true, name: true, phone: true, email: true } },
        table: { select: { id: true, name: true, branchId: true } },
        transaction: {
          include: {
            journalEntries: {
              include: {
                lines: { include: { account: { select: { code: true, name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    return NextResponse.json(formatInvoice(invoice));
  } catch (error: any) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الفاتورة' },
      { status: 500 }
    );
  }
}

// PUT /api/pos/invoices/[id] - Update invoice (items, discount, payment method, customer, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const { id } = await params;
    const body = await request.json();
    const { items, discountPercentage, discountAmount, paymentMethod, customerId, customerName, tableId, notes, status, receiptHtml } = body;

    const existing = await db.pOSInvoice.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    // CANCELLATION: Instead of marking as CANCELLED, invoices are now DELETED entirely.
    // This prevents system inconsistencies from retained cancelled invoices.
    // Frontend should use DELETE /api/pos/invoices/[id] instead of PUT with status=CANCELLED.
    // If a CANCELLED status is still sent, redirect to delete behavior.
    if (status === 'CANCELLED') {
      if (existing.status === 'FINALIZED') {
        return NextResponse.json(
          { error: 'لا يمكن إلغاء فاتورة مرحّلة مباشرة - يجب إلغاء القيد المحاسبي أولاً' },
          { status: 400 }
        );
      }

      // Delete the draft invoice entirely instead of keeping it as CANCELLED
      await db.$transaction(async (tx) => {
        await tx.pOSInvoicePayment.deleteMany({ where: { invoiceId: id } });
        await tx.pOSInvoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.pOSInvoice.delete({ where: { id } });
      });

      return NextResponse.json({
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        status: 'DELETED',
        message: 'تم حذف الفاتورة بنجاح / Invoice deleted successfully',
      });
    }

    if (existing.status !== 'DRAFT' && auth.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'لا يمكن تعديل فاتورة غير مسودة - فقط مدير النظام يمكنه ذلك' },
        { status: 400 }
      );
    }

    // Validate max discount percentage from settings
    if (discountPercentage !== undefined && discountPercentage > 0) {
      const maxDiscountSetting = await db.setting.findUnique({ where: { key: 'maxDiscountPercentage' } });
      const maxDiscount = maxDiscountSetting ? parseFloat(maxDiscountSetting.value) : 0;
      if (maxDiscount > 0 && discountPercentage > maxDiscount) {
        return NextResponse.json(
          { error: `الحد الأعلى لنسبة الخصم هو ${maxDiscount}% / Maximum discount limit is ${maxDiscount}%` },
          { status: 400 }
        );
      }
    }

    const invoice = await db.$transaction(async (tx) => {
      // If items are provided, replace them
      if (items && Array.isArray(items)) {
        await tx.pOSInvoiceItem.deleteMany({ where: { invoiceId: id } });

        const invoiceItems = items.map((item: any, index: number) => {
          const quantity = item.quantity ?? 1;
          // Support both 'price' and 'unitPrice' field names
          const unitPrice = item.unitPrice ?? item.price ?? 0;
          const totalPrice = quantity * unitPrice;
          return {
            name: item.name || 'عنصر',
            nameEn: item.nameEn || null,
            productId: item.productId || null,
            quantity,
            unitPrice,
            totalPrice,
            notes: item.notes || null,
            sortOrder: item.sortOrder ?? index,
            invoiceId: id,
          };
        });

        await tx.pOSInvoiceItem.createMany({ data: invoiceItems });
      }

      // Resolve customer name if customerId is updated
      let resolvedCustomerName = customerName;
      if (customerId !== undefined && !resolvedCustomerName) {
        if (customerId) {
          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { name: true },
          });
          resolvedCustomerName = customer?.name || null;
        } else {
          resolvedCustomerName = null;
        }
      }

      // Recalculate totals
      const currentItems = await tx.pOSInvoiceItem.findMany({
        where: { invoiceId: id },
        orderBy: { sortOrder: 'asc' },
      });

      const subtotal = currentItems.reduce((sum, item) => sum + toNumber(item.totalPrice), 0);

      // Support percentage-based discount
      // Priority: discountPercentage > discountAmount > existing values
      let pct: number;
      let amt: number;

      if (discountPercentage !== undefined) {
        pct = Math.min(Math.max(discountPercentage, 0), 100);
        amt = Math.round(subtotal * (pct / 100) * 100) / 100;
      } else if (discountAmount !== undefined) {
        amt = Math.min(Math.max(discountAmount, 0), subtotal);
        pct = subtotal > 0 ? Math.round((amt / subtotal) * 10000) / 100 : 0;
      } else {
        pct = toNumber(existing.discountPercentage) ?? 0;
        amt = toNumber(existing.discountAmount) ?? 0;
        // Recalculate amount from percentage if subtotal changed
        amt = Math.round(subtotal * (pct / 100) * 100) / 100;
      }

      const taxableAmount = Math.max(0, subtotal - amt);
      // Use per-branch tax rate override (branch.taxRate) when set
      const globalTaxRateSetting = await db.setting.findUnique({ where: { key: 'taxRate' } });
      const effectiveTaxRate = await getEffectiveTaxRate(existing.branchId, globalTaxRateSetting?.value ?? null);
      const taxAmount = Math.round(taxableAmount * effectiveTaxRate * 100) / 100;
      const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

      // Update invoice
      const updateData: any = {
        subtotal,
        discountPercentage: pct,
        discountAmount: amt,
        taxAmount,
        totalAmount,
      };

      if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
      if (customerId !== undefined) updateData.customerId = customerId || null;
      if (resolvedCustomerName !== undefined) updateData.customerName = resolvedCustomerName;
      if (tableId !== undefined) updateData.tableId = tableId || null;
      if (notes !== undefined) updateData.notes = notes;
      // SECURITY: Block direct status changes - status must flow through proper channels
      // CANCELLED → via the cancel check above; FINALIZED → via /api/pos/finalize
      // if (status !== undefined) updateData.status = status;  // REMOVED: unsafe
      if (receiptHtml !== undefined) updateData.receiptHtml = receiptHtml;

      const updated = await tx.pOSInvoice.update({
        where: { id },
        data: updateData,
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          payments: true,
          customer: { select: { id: true, name: true, phone: true } },
          table: { select: { id: true, name: true } },
        },
      });

      return updated;
    });

    return NextResponse.json(formatInvoice(invoice));
  } catch (error: any) {
    console.error('Error updating invoice:', error);
    return NextResponse.json(
      { error: 'فشل في تحديث الفاتورة' },
      { status: 500 }
    );
  }
}

// DELETE /api/pos/invoices/[id] - Delete an invoice
// RULE: If a FINALIZED invoice is deleted,
// ALL related accounting entries, transactions, stock movements, and traces
// must be permanently removed from the system.
// DRAFT/CANCELLED invoices are simply hard-deleted.
//
// Role requirements:
//   - DRAFT/CANCELLED: CASHIER+ (supervisor password verified on frontend)
//   - FINALIZED: MANAGER+ with supervisor password (accounting integrity)
//   - RETURNED: ADMIN only (reversal entries exist)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // First, peek at the invoice to determine the required role
    const { id } = await params;
    const peekInvoice = await db.pOSInvoice.findUnique({
      where: { id },
      select: { status: true },
    });

    // DRAFT/CANCELLED invoices can be deleted by CASHIER+;
    // FINALIZED require MANAGER+; RETURNED require ADMIN
    const requiredRole = peekInvoice?.status === 'RETURNED' ? 'ADMIN'
      : peekInvoice?.status === 'FINALIZED' ? 'MANAGER'
      : 'CASHIER';

    const auth = await requireRole(requiredRole as any);
    if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;

    const existing = await db.pOSInvoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    // DRAFT and CANCELLED invoices: simple hard delete
    if (existing.status === 'DRAFT' || existing.status === 'CANCELLED') {
      await db.$transaction(async (tx) => {
        await tx.pOSInvoicePayment.deleteMany({ where: { invoiceId: id } });
        await tx.pOSInvoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.pOSInvoice.delete({ where: { id } });
      });

      return NextResponse.json({
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        status: existing.status,
        message: 'تم حذف الفاتورة بنجاح',
      });
    }

    // FINALIZED invoices: AUDIT-9-18 — Soft-void instead of hard-delete cascade.
    // Marks the invoice as CANCELLED, cancels linked journal entries + transactions
    // (preserving the audit trail), restores product stock, and annotates stock
    // transactions. Nothing is permanently destroyed — every action is reversible
    // and auditable. Previously this branch did `deleteMany` on journalLines/
    // journalEntries/transactions/stockTransactions and `delete` on the invoice,
    // which violated the accounting principle of preserving audit history.
    if (existing.status === 'FINALIZED') {
      await db.$transaction(async (tx) => {
        // 1. Find ALL Transactions linked to this invoice by invoiceNumber
        //    (split payments create multiple Transactions — one per payment method)
        const transactions = await tx.transaction.findMany({
          where: { invoiceNumber: existing.invoiceNumber },
          include: { journalEntries: { include: { lines: true } } },
        });

        const affectedAccountIds = new Set<string>();

        for (const transaction of transactions) {
          // 2. CANCEL (not delete) each journal entry — preserves the row + lines for audit
          for (const je of transaction.journalEntries) {
            for (const line of je.lines) {
              affectedAccountIds.add(line.accountId);
            }
            if (je.status !== 'CANCELLED') {
              await tx.journalEntry.update({
                where: { id: je.id },
                data: { status: 'CANCELLED' },
              });
            }
          }
          // 3. Mark the Transaction itself as CANCELLED (soft-void)
          if (transaction.status !== 'CANCELLED') {
            await tx.transaction.update({
              where: { id: transaction.id },
              data: { status: 'CANCELLED' },
            });
          }
        }

        // 4. Restore product stock for items that were decremented at finalize time
        for (const item of existing.items) {
          if (item.productId) {
            await tx.product.update({
              where: { id: item.productId },
              data: { currentStock: { increment: item.quantity } },
            });
          }
        }

        // 5. Annotate stock transactions linked to this invoice with a VOIDED note
        //    (StockTransaction has no status field — annotate via notes so reports
        //    can filter; stock has already been restored in step 4)
        await tx.stockTransaction.updateMany({
          where: { referenceId: id, referenceType: 'POS_INVOICE' },
          data: { notes: { set: `[VOIDED ${new Date().toISOString()}]` } },
        });

        // 6. Mark the POS invoice as CANCELLED (soft-void — preserves invoice record + audit trail)
        await tx.pOSInvoice.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });

        // 7. Recalculate account balances for all affected accounts
        for (const accountId of affectedAccountIds) {
          await updateAccountBalance(accountId, tx);
        }
      }, { maxWait: 10000, timeout: 20000 });

      // Audit log the void (CRITICAL — financial reversal)
      auditLog({
        action: 'DELETE',
        entity: 'POS_INVOICE',
        entityId: existing.id,
        entityNumber: existing.invoiceNumber,
        description: `Soft-void FINALIZED invoice ${existing.invoiceNumber} (preserved audit trail)`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: existing.branchId,
        severity: 'CRITICAL',
        category: 'POS',
        details: { previousStatus: 'FINALIZED', newStatus: 'CANCELLED' },
      }).catch(() => {});

      return NextResponse.json({
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        status: 'CANCELLED',
        message: 'تم إلغاء الفاتورة المرحّلة برفق (soft-void) — تم الحفاظ على سجل التدقيق والقيود المحاسبية / Finalized invoice soft-voided; accounting entries and audit trail preserved',
      });
    }

    // RETURNED invoices: ADMIN can soft-void (cancel reversal + restore). Others cannot.
    if (existing.status === 'RETURNED') {
      if (auth.role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'لا يمكن حذف فاتورة مرتجعة - فقط مدير النظام يمكنه ذلك / Only admin can void returned invoices' },
          { status: 400 }
        );
      }
      // ADMIN voiding a RETURNED invoice: cancel reversal entries + restore original invoice
      // AUDIT-9-18: Soft-void (CANCELLED) rather than hard delete — preserves audit trail.
      await db.$transaction(async (tx) => {
        const affectedAccountIds = new Set<string>();

        // Cancel all transactions + journal entries linked to the return invoice
        const returnTransactions = await tx.transaction.findMany({
          where: { invoiceNumber: existing.invoiceNumber },
          include: { journalEntries: { include: { lines: true } } },
        });
        for (const txn of returnTransactions) {
          for (const je of txn.journalEntries) {
            for (const line of je.lines) affectedAccountIds.add(line.accountId);
            if (je.status !== 'CANCELLED') {
              await tx.journalEntry.update({
                where: { id: je.id },
                data: { status: 'CANCELLED' },
              });
            }
          }
          if (txn.status !== 'CANCELLED') {
            await tx.transaction.update({
              where: { id: txn.id },
              data: { status: 'CANCELLED' },
            });
          }
        }
        for (const accountId of affectedAccountIds) {
          await updateAccountBalance(accountId, tx);
        }

        // Restore the original invoice's status from RETURNED → FINALIZED
        // (the return is now voided, so the original sale stands)
        if (existing.originalInvoiceId) {
          const original = await tx.pOSInvoice.findUnique({
            where: { id: existing.originalInvoiceId },
            select: { id: true, invoiceNumber: true, status: true },
          });
          if (original && original.status === 'RETURNED') {
            await tx.pOSInvoice.update({
              where: { id: original.id },
              data: { status: 'FINALIZED' },
            });
          }
        }

        // Soft-void the return invoice itself
        await tx.pOSInvoice.update({
          where: { id },
          data: { status: 'CANCELLED' },
        });
      }, { maxWait: 10000, timeout: 20000 });

      // Audit log the void (CRITICAL — financial reversal)
      auditLog({
        action: 'DELETE',
        entity: 'POS_INVOICE',
        entityId: existing.id,
        entityNumber: existing.invoiceNumber,
        description: `Soft-void RETURNED invoice ${existing.invoiceNumber} (preserved audit trail, original sale restored)`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        branchId: existing.branchId,
        severity: 'CRITICAL',
        category: 'POS',
        details: { previousStatus: 'RETURNED', newStatus: 'CANCELLED' },
      }).catch(() => {});

      return NextResponse.json({
        id: existing.id,
        invoiceNumber: existing.invoiceNumber,
        status: 'CANCELLED',
        message: 'تم إلغاء الفاتورة المرتجعة برفق (soft-void) — تم الحفاظ على سجل التدقيق / Returned invoice soft-voided; audit trail preserved',
      });
    }
  } catch (error: any) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الفاتورة' },
      { status: 500 }
    );
  }
}
