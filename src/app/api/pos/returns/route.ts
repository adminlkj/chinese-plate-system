import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createTransaction } from '@/lib/accounting-engine';
import type { JournalEntryType, PaymentMethod } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { auditReturn } from '@/lib/audit-log';
// Branch type no longer needed — createTransaction accepts branchId (UUID) directly

// Bank card payment methods
const BANK_PAYMENT_METHODS: PaymentMethod[] = ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];

// POST /api/pos/returns - Create a return for a finalized invoice
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('MANAGER'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { originalInvoiceId, notes } = body;

    if (!originalInvoiceId) {
      return NextResponse.json({ error: 'معرف الفاتورة الأصلية مطلوب' }, { status: 400 });
    }

    // Fetch the original invoice
    const originalInvoice = await db.pOSInvoice.findUnique({
      where: { id: originalInvoiceId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        customer: { select: { id: true, name: true, type: true } },
      },
    });

    if (!originalInvoice) {
      return NextResponse.json({ error: 'الفاتورة الأصلية غير موجودة' }, { status: 404 });
    }

    if (originalInvoice.status !== 'FINALIZED') {
      return NextResponse.json({ error: 'يمكن إرجاع الفواتير المُنهية فقط' }, { status: 400 });
    }

    if (originalInvoice.isReturn) {
      return NextResponse.json({ error: 'لا يمكن إرجاع فاتورة مرتجع' }, { status: 400 });
    }

    // Verify the user has access to the original invoice's branch
    const branchCheck = assertBranchAccess(auth, originalInvoice.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Check if already returned
    const existingReturn = await db.pOSInvoice.findFirst({
      where: { originalInvoiceId, isReturn: true, status: { not: 'CANCELLED' } },
    });
    if (existingReturn) {
      return NextResponse.json({ error: 'تم إنشاء مرتجع لهذه الفاتورة بالفعل' }, { status: 400 });
    }

    const originalSubtotal = toNumber(originalInvoice.subtotal);
    const originalTaxAmount = toNumber(originalInvoice.taxAmount);
    const originalDiscountAmount = toNumber(originalInvoice.discountAmount);
    // Pass the GROSS subtotal (not net) to the accounting engine to avoid
    // double-subtraction of the discount in cashReceived/bankReceived/arAmount.

    // Execute everything in a transaction
    const result = await db.$transaction(async (tx) => {
      // Generate return invoice number with its own sequence
      const lastRetInvoice = await tx.pOSInvoice.findFirst({
        where: { invoiceNumber: { startsWith: 'RET-' } },
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true },
      });
      const retNum = lastRetInvoice
        ? parseInt(lastRetInvoice.invoiceNumber.replace('RET-', '')) + 1
        : 1;
      const returnInvoiceNumber = `RET-${String(retNum).padStart(4, '0')}`;

      // 1. Create return POSInvoice
      const returnInvoice = await tx.pOSInvoice.create({
        data: {
          invoiceNumber: returnInvoiceNumber,
          branchId: originalInvoice.branchId,
          status: 'FINALIZED',
          customerId: originalInvoice.customerId,
          customerName: originalInvoice.customerName,
          subtotal: originalInvoice.subtotal,
          discountPercentage: originalInvoice.discountPercentage,
          discountAmount: originalInvoice.discountAmount,
          taxAmount: originalInvoice.taxAmount,
          totalAmount: originalInvoice.totalAmount,
          paidAmount: originalInvoice.paidAmount,
          changeAmount: 0,
          paymentMethod: originalInvoice.paymentMethod,
          isReturn: true,
          originalInvoiceId: originalInvoice.id,
          notes: notes || `مرتجع للفاتورة ${originalInvoice.invoiceNumber}`,
          items: {
            create: originalInvoice.items.map((item) => ({
              productId: item.productId,
              name: item.name,
              nameEn: item.nameEn,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              notes: item.notes,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true } },
        },
      });

      // 2. Create reverse payment records
      if (originalInvoice.payments.length > 0) {
        await Promise.all(
          originalInvoice.payments.map((p) =>
            tx.pOSInvoicePayment.create({
              data: {
                invoiceId: returnInvoice.id,
                method: p.method,
                amount: p.amount,
              },
            })
          )
        );
      }

      // 3. Create reverse accounting entries based on original payment methods
      let transactionId: string | undefined;

      // Group original payments by type
      const cashPayments = originalInvoice.payments.filter((p) => p.method === 'CASH');
      const bankPayments = originalInvoice.payments.filter(
        (p) => BANK_PAYMENT_METHODS.includes(p.method as PaymentMethod)
      );
      const creditPayments = originalInvoice.payments.filter((p) => p.method === 'CREDIT');

      const totalCashAmount = cashPayments.reduce((sum, p) => sum + toNumber(p.amount), 0);
      const totalBankAmount = bankPayments.reduce((sum, p) => sum + toNumber(p.amount), 0);
      const totalCreditAmount = creditPayments.reduce((sum, p) => sum + toNumber(p.amount), 0);
      const totalPaymentAmount = totalCashAmount + totalBankAmount + totalCreditAmount;

      if (totalCreditAmount > 0 && (totalCashAmount > 0 || totalBankAmount > 0)) {
        // Mixed return
        const cashRatio = totalPaymentAmount > 0 ? totalCashAmount / totalPaymentAmount : 0;
        const bankRatio = totalPaymentAmount > 0 ? totalBankAmount / totalPaymentAmount : 0;
        const creditRatio = totalPaymentAmount > 0 ? totalCreditAmount / totalPaymentAmount : 0;

        if (totalCashAmount > 0) {
          const entry = await createTransaction({
            type: 'SALE_RETURN_CASH' as JournalEntryType,
            date: new Date(),
            description: `مرتجع فاتورة (نقدي) - ${originalInvoice.invoiceNumber}`,
            amount: Math.round(originalSubtotal * cashRatio * 100) / 100,
            branchId: originalInvoice.branchId,
            paymentMethod: 'CASH' as PaymentMethod,
            applyTax: true,
            taxAmount: Math.round(originalTaxAmount * cashRatio * 100) / 100,
            discountAmount: Math.round(originalDiscountAmount * cashRatio * 100) / 100,
            customerId: originalInvoice.customerId ?? undefined,
            counterParty: originalInvoice.customerName || 'عميل نقدي',
            invoiceNumber: returnInvoiceNumber,
            status: 'POSTED',
            parentTransactionId: originalInvoice.transactionId || undefined,
            tx,
          });
          if (!transactionId && entry.transactionId) transactionId = entry.transactionId;
        }

        if (totalBankAmount > 0) {
          const entry = await createTransaction({
            type: 'SALE_RETURN_BANK' as JournalEntryType,
            date: new Date(),
            description: `مرتجع فاتورة (بنكي) - ${originalInvoice.invoiceNumber}`,
            amount: Math.round(originalSubtotal * bankRatio * 100) / 100,
            branchId: originalInvoice.branchId,
            paymentMethod: (bankPayments[0]?.method || 'MADA') as PaymentMethod,
            applyTax: true,
            taxAmount: Math.round(originalTaxAmount * bankRatio * 100) / 100,
            discountAmount: Math.round(originalDiscountAmount * bankRatio * 100) / 100,
            customerId: originalInvoice.customerId ?? undefined,
            counterParty: originalInvoice.customerName || 'عميل نقدي',
            invoiceNumber: returnInvoiceNumber,
            status: 'POSTED',
            parentTransactionId: originalInvoice.transactionId || undefined,
            tx,
          });
          if (!transactionId && entry.transactionId) transactionId = entry.transactionId;
        }

        if (totalCreditAmount > 0) {
          const entry = await createTransaction({
            type: 'SALE_RETURN_PLATFORM' as JournalEntryType,
            date: new Date(),
            description: `مرتجع فاتورة (آجل) - ${originalInvoice.invoiceNumber}`,
            amount: Math.round(originalSubtotal * creditRatio * 100) / 100,
            branchId: originalInvoice.branchId,
            paymentMethod: 'CREDIT' as PaymentMethod,
            applyTax: true,
            taxAmount: Math.round(originalTaxAmount * creditRatio * 100) / 100,
            discountAmount: Math.round(originalDiscountAmount * creditRatio * 100) / 100,
            customerId: originalInvoice.customerId ?? undefined,
            counterParty: originalInvoice.customerName || 'عميل آجل',
            invoiceNumber: returnInvoiceNumber,
            status: 'POSTED',
            parentTransactionId: originalInvoice.transactionId || undefined,
            tx,
          });
          if (!transactionId && entry.transactionId) transactionId = entry.transactionId;
        }
      } else if (totalCashAmount > 0 && totalBankAmount > 0) {
        const splitTotal = totalCashAmount + totalBankAmount;
        const cashSplitRatio = totalCashAmount / splitTotal;
        const bankSplitRatio = totalBankAmount / splitTotal;

        const cashEntry = await createTransaction({
          type: 'SALE_RETURN_CASH' as JournalEntryType,
          date: new Date(),
          description: `مرتجع فاتورة (نقدي) - ${originalInvoice.invoiceNumber}`,
          amount: Math.round(originalSubtotal * cashSplitRatio * 100) / 100,
          branchId: originalInvoice.branchId,
          paymentMethod: 'CASH' as PaymentMethod,
          applyTax: true,
          taxAmount: Math.round(originalTaxAmount * cashSplitRatio * 100) / 100,
          discountAmount: Math.round(originalDiscountAmount * cashSplitRatio * 100) / 100,
          customerId: originalInvoice.customerId ?? undefined,
          counterParty: originalInvoice.customerName || 'عميل نقدي',
          invoiceNumber: returnInvoiceNumber,
          status: 'POSTED',
          parentTransactionId: originalInvoice.transactionId || undefined,
          tx,
        });

        const bankEntry = await createTransaction({
          type: 'SALE_RETURN_BANK' as JournalEntryType,
          date: new Date(),
          description: `مرتجع فاتورة (بنكي) - ${originalInvoice.invoiceNumber}`,
          amount: Math.round(originalSubtotal * bankSplitRatio * 100) / 100,
          branchId: originalInvoice.branchId,
          paymentMethod: (bankPayments[0]?.method || 'MADA') as PaymentMethod,
          applyTax: true,
          taxAmount: Math.round(originalTaxAmount * bankSplitRatio * 100) / 100,
          discountAmount: Math.round(originalDiscountAmount * bankSplitRatio * 100) / 100,
          customerId: originalInvoice.customerId ?? undefined,
          counterParty: originalInvoice.customerName || 'عميل نقدي',
          invoiceNumber: returnInvoiceNumber,
          status: 'POSTED',
          parentTransactionId: originalInvoice.transactionId || undefined,
          tx,
        });

        transactionId = cashEntry.transactionId ?? bankEntry.transactionId ?? undefined;
      } else if (totalCashAmount > 0) {
        const entry = await createTransaction({
          type: 'SALE_RETURN_CASH' as JournalEntryType,
          date: new Date(),
          description: `مرتجع فاتورة - ${originalInvoice.invoiceNumber}`,
          amount: originalSubtotal,
          branchId: originalInvoice.branchId,
          paymentMethod: 'CASH' as PaymentMethod,
          applyTax: true,
          taxAmount: originalTaxAmount,
          discountAmount: originalDiscountAmount,
          customerId: originalInvoice.customerId ?? undefined,
          counterParty: originalInvoice.customerName || 'عميل نقدي',
          invoiceNumber: returnInvoiceNumber,
          status: 'POSTED',
          parentTransactionId: originalInvoice.transactionId || undefined,
          tx,
        });
        transactionId = entry.transactionId ?? undefined;
      } else if (totalBankAmount > 0) {
        const entry = await createTransaction({
          type: 'SALE_RETURN_BANK' as JournalEntryType,
          date: new Date(),
          description: `مرتجع فاتورة - ${originalInvoice.invoiceNumber}`,
          amount: originalSubtotal,
          branchId: originalInvoice.branchId,
          paymentMethod: (bankPayments[0]?.method || 'MADA') as PaymentMethod,
          applyTax: true,
          taxAmount: originalTaxAmount,
          discountAmount: originalDiscountAmount,
          customerId: originalInvoice.customerId ?? undefined,
          counterParty: originalInvoice.customerName || 'عميل نقدي',
          invoiceNumber: returnInvoiceNumber,
          status: 'POSTED',
          parentTransactionId: originalInvoice.transactionId || undefined,
          tx,
        });
        transactionId = entry.transactionId ?? undefined;
      } else if (totalCreditAmount > 0) {
        const entry = await createTransaction({
          type: 'SALE_RETURN_PLATFORM' as JournalEntryType,
          date: new Date(),
          description: `مرتجع فاتورة (آجل) - ${originalInvoice.invoiceNumber}`,
          amount: originalSubtotal,
          branchId: originalInvoice.branchId,
          paymentMethod: 'CREDIT' as PaymentMethod,
          applyTax: true,
          taxAmount: originalTaxAmount,
          discountAmount: originalDiscountAmount,
          customerId: originalInvoice.customerId ?? undefined,
          counterParty: originalInvoice.customerName || 'عميل آجل',
          invoiceNumber: returnInvoiceNumber,
          status: 'POSTED',
          parentTransactionId: originalInvoice.transactionId || undefined,
          tx,
        });
        transactionId = entry.transactionId ?? undefined;
      }

      // Update return invoice with transaction link
      if (transactionId) {
        await tx.pOSInvoice.update({
          where: { id: returnInvoice.id },
          data: { transactionId },
        });
      }

      // 4. Mark original invoice as RETURNED
      await tx.pOSInvoice.update({
        where: { id: originalInvoiceId },
        data: { status: 'RETURNED' },
      });

      // 5. Restore stock for each item
      const productIds = originalInvoice.items
        .map((item) => item.productId)
        .filter((id): id is string => id !== null);

      const products =
        productIds.length > 0
          ? await tx.product.findMany({
              where: { id: { in: productIds } },
              select: { id: true, costPrice: true },
            }) as any[]
          : [];
      const productMap = new Map(products.map((p) => [p.id, p]));

      for (const item of originalInvoice.items) {
        if (item.productId) {
          const product = productMap.get(item.productId);
          if (product) {
            // Create stock transaction (RETURN = increment)
            await tx.stockTransaction.create({
              data: {
                productId: item.productId,
                type: 'RETURN',
                quantity: item.quantity, // Positive = in
                costPrice: product.costPrice,
                totalCost: toNumber(product.costPrice) * toNumber(item.quantity),
                reference: returnInvoiceNumber,
                referenceType: 'POS_INVOICE',
                referenceId: returnInvoice.id,
                notes: `مرتجع فاتورة - ${item.name}`,
                branchId: originalInvoice.branchId,
              },
            });

            // Update product current stock
            await tx.product.update({
              where: { id: item.productId },
              data: {
                currentStock: { increment: item.quantity },
              },
            });
          }
        }
      }

      // ─── COGS reversal journal entry REMOVED ───
      // COGS is no longer auto-created on sale (see finalize route), so we
      // don't need to reverse it on return either. COGS should be calculated
      // from purchase records at reporting time, not from per-item costPrice.

      // Fetch the complete return invoice with payments
      const completeReturn = await tx.pOSInvoice.findUnique({
        where: { id: returnInvoice.id },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          payments: true,
          customer: { select: { id: true, name: true } },
          originalInvoice: { select: { id: true, invoiceNumber: true } },
        },
      });

      return completeReturn;
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    if (!result) {
      return NextResponse.json({ error: 'فشل في إنشاء فاتورة المرتجع' }, { status: 500 });
    }

    // Audit log the return event (non-blocking)
    if (auth.authenticated && result) {
      auditReturn(
        'POS_INVOICE',
        result.id,
        result.invoiceNumber,
        `مرتجع فاتورة: ${result.invoiceNumber} - الفاتورة الأصلية: ${originalInvoice.invoiceNumber}`,
        auth.userId,
        auth.email,
        auth.role,
        (result.branchId as string) || undefined
      ).catch(() => {});
    }

    return NextResponse.json({
      ...result,
      subtotal: toNumber(result.subtotal),
      discountPercentage: toNumber(result.discountPercentage),
      discountAmount: toNumber(result.discountAmount),
      taxAmount: toNumber(result.taxAmount),
      totalAmount: toNumber(result.totalAmount),
      paidAmount: toNumber(result.paidAmount),
      changeAmount: toNumber(result.changeAmount),
      items: result.items?.map((item: any) => ({
        ...item,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        totalPrice: toNumber(item.totalPrice),
      })),
      payments: result.payments?.map((p: any) => ({
        ...p,
        amount: toNumber(p.amount),
      })),
    });
  } catch (error: any) {
    console.error('Error creating return:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء المرتجع' },
      { status: 500 }
    );
  }
}
