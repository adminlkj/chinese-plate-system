import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createTransaction } from '@/lib/accounting-engine';
import type { JournalEntryType, PaymentMethod } from '@/lib/types';
import { toNumber } from '@/lib/decimal';
import { requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import { auditFinalize } from '@/lib/audit-log';

// Bank card payment methods that should use البنك (bank account) for debit
const BANK_PAYMENT_METHODS: PaymentMethod[] = ['MADA', 'VISA', 'MASTERCARD', 'OTHER_CARD'];

// Credit (آجل) payment method for platform customers — goes to Accounts Receivable
const CREDIT_PAYMENT_METHOD = 'CREDIT';

// POST /api/pos/finalize - Finalize a draft invoice with multi-payment support
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole('CASHIER'); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { invoiceId, paymentMethod, payments, customerId: bodyCustomerId, customerName: bodyCustomerName } = body;

    if (!invoiceId) {
      return NextResponse.json(
        { error: 'معرف الفاتورة مطلوب' },
        { status: 400 }
      );
    }

    // Resolve payments array: support both new `payments` array and legacy `paymentMethod`
    let resolvedPayments: { method: string; amount: number }[];

    if (payments && Array.isArray(payments) && payments.length > 0) {
      // New multi-payment mode
      resolvedPayments = payments.map((p: any) => ({
        method: String(p.method),
        amount: parseFloat(String(p.amount)),
      }));

      // Validate each payment entry
      for (const p of resolvedPayments) {
        if (!p.method) {
          return NextResponse.json(
            { error: 'طريقة الدفع مطلوبة لكل عملية' },
            { status: 400 }
          );
        }
        if (p.amount < 0) {
          return NextResponse.json(
            { error: 'لا يمكن إدخال مبلغ دفع سالب' },
            { status: 400 }
          );
        }
      }

      // Filter out payments with zero amounts (keep only valid payments)
      // This handles cases where a payment row exists but wasn't filled in
      resolvedPayments = resolvedPayments.filter(p => p.amount > 0);
    } else if (paymentMethod) {
      // Backward compatibility: single payment method
      // We'll set the amount after fetching the invoice
      resolvedPayments = []; // Will be populated below
    } else {
      return NextResponse.json(
        { error: 'طريقة الدفع أو قائمة المدفوعات مطلوبة' },
        { status: 400 }
      );
    }

    // Fetch the invoice with items
    const invoice = await db.pOSInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        customer: { select: { id: true, name: true, phone: true } },
        table: { select: { id: true, name: true } },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { error: 'الفاتورة غير موجودة' },
        { status: 404 }
      );
    }

    // Verify the user has access to this invoice's branch
    const branchCheck = assertBranchAccess(auth, invoice.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    if (invoice.status !== 'DRAFT') {
      return NextResponse.json(
        { error: 'يمكن إنهاء الفواتير في حالة المسودة فقط' },
        { status: 400 }
      );
    }

    // Validate max discount percentage.
    // Per-branch override (branch.maxDiscountPercentage) takes precedence over
    // the global setting; if the branch value is null, fall back to the global
    // setting. A value of 0 means "no limit".
    const branch = await db.branch.findUnique({
      where: { id: invoice.branchId },
      select: { maxDiscountPercentage: true, taxRate: true },
    });
    const maxDiscountSetting = await db.setting.findUnique({ where: { key: 'maxDiscountPercentage' } });
    const globalMaxDiscount = maxDiscountSetting ? parseFloat(maxDiscountSetting.value) : 0;
    const branchMaxDiscount =
      branch?.maxDiscountPercentage !== null && branch?.maxDiscountPercentage !== undefined
        ? toNumber(branch.maxDiscountPercentage)
        : globalMaxDiscount;
    if (branchMaxDiscount > 0 && toNumber(invoice.discountPercentage) > branchMaxDiscount) {
      return NextResponse.json(
        { error: `الحد الأعلى لنسبة الخصم هو ${branchMaxDiscount}% / Maximum discount limit is ${branchMaxDiscount}%` },
        { status: 400 }
      );
    }

    // Validate: invoice must have at least one item
    if (!invoice.items || invoice.items.length === 0) {
      return NextResponse.json(
        { error: 'لا يمكن إنهاء فاتورة بدون أصناف' },
        { status: 400 }
      );
    }

    // Validate: all items must have quantity > 0 and price >= 0
    for (const item of invoice.items) {
      const qty = toNumber(item.quantity);
      const price = toNumber(item.unitPrice);
      if (qty <= 0) {
        return NextResponse.json(
          { error: `الصنف "${item.name}" له كمية غير صالحة (${qty}). يجب أن تكون الكمية أكبر من صفر` },
          { status: 400 }
        );
      }
      if (price < 0) {
        return NextResponse.json(
          { error: `الصنف "${item.name}" له سعر غير صالح (${price}). لا يمكن أن يكون السعر سالباً` },
          { status: 400 }
        );
      }
    }

    // Resolve customerId: use invoice's customerId, fallback to request body
    // This ensures the Transaction is linked to the customer even if the
    // invoice's customerId wasn't saved (e.g., timing issue in the POS screen)
    // 'cash_unregistered' is treated the same as 'cash' — no customer linked
    const isCashUnregistered = bodyCustomerId === 'cash_unregistered' || bodyCustomerId === 'cash';
    const effectiveCustomerId = invoice.customerId || (!isCashUnregistered && bodyCustomerId ? bodyCustomerId : null) || null;
    const effectiveCustomerName = invoice.customerName || bodyCustomerName || null;

    // If legacy single payment, set amount = totalAmount
    if (resolvedPayments.length === 0 && paymentMethod) {
      resolvedPayments = [{ method: paymentMethod, amount: toNumber(invoice.totalAmount) }];
    }

    // Validate: CREDIT (آجل) payments MUST have a customer linked
    // A receivable without a customer makes no accounting sense
    const willHaveCredit = resolvedPayments.some(p => p.method === 'CREDIT');
    if (willHaveCredit && !effectiveCustomerId) {
      return NextResponse.json(
        { error: 'طريقة الدفع الآجل تتطلب اختيار عميل منصة' },
        { status: 400 }
      );
    }

    // Validate: at least one valid payment must exist
    if (resolvedPayments.length === 0) {
      return NextResponse.json(
        { error: 'يجب إضافة طريقة دفع واحدة على الأقل بمبلغ أكبر من صفر' },
        { status: 400 }
      );
    }

    // Calculate total paid from payments array
    const totalPaid = resolvedPayments.reduce((sum, p) => sum + p.amount, 0);

    // Validate: total payments (including credit/آجل) must cover the invoice total
    const invoiceTotal = toNumber(invoice.totalAmount);
    if (totalPaid < invoiceTotal - 0.01) {
      return NextResponse.json(
        { error: `مبلغ الدفع الإجمالي (${totalPaid.toFixed(2)}) أقل من إجمالي الفاتورة (${invoiceTotal.toFixed(2)})` },
        { status: 400 }
      );
    }

    // Calculate change
    const changeAmount = Math.max(0, Math.round((totalPaid - invoiceTotal) * 100) / 100);

    // Determine primary payment method
    let primaryPaymentMethod: string;
    if (resolvedPayments.length === 1) {
      primaryPaymentMethod = resolvedPayments[0].method;
    } else {
      primaryPaymentMethod = 'SPLIT';
    }

    // Determine transaction type based on primary payment method
    // For SPLIT payments, we need to create separate journal entries per payment method
    const invoiceSubtotal = toNumber(invoice.subtotal);
    const invoiceDiscount = toNumber(invoice.discountAmount);
    const invoiceTax = toNumber(invoice.taxAmount);
    // Pass the GROSS subtotal as amount to the accounting engine so that
    // the formula `amount + tax - discount` doesn't double-subtract the discount.
    // Previously we passed baseAmount (= subtotal - discount), which caused
    // the accounting engine to debit Cash/Bank/AR at (subtotal - discount) + tax - discount
    // = subtotal + tax - 2*discount — an underpayment by the discount amount.

    // Use transaction for all operations with increased timeout
    const result = await db.$transaction(async (tx) => {
      // ─── RE-FETCH invoice inside transaction to prevent TOCTOU race condition ───
      const invoiceInTx = await tx.pOSInvoice.findUnique({
        where: { id: invoiceId },
        select: { status: true },
      });
      if (!invoiceInTx || invoiceInTx.status !== 'DRAFT') {
        throw new Error('يمكن إنهاء الفواتير في حالة المسودة فقط / Invoice must be in DRAFT status');
      }

      // ─── Auto-adjust stock for each item linked to a product ───
      // For normal invoices: decrement stock (sale out)
      // For return invoices: increment stock (return in)
      const isReturn = invoice.isReturn === true;

      // Batch fetch all products at once to reduce queries
      const productIds = invoice.items
        .map(item => item.productId)
        .filter((id): id is string => id !== null);
      
      const products = productIds.length > 0
        ? await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, costPrice: true, currentStock: true, name: true },
          }) as any[]
        : [];
      const productMap = new Map(products.map(p => [p.id, p]));

      // ─── Stock check removed: Restaurants assemble meals from raw materials ───
      // Sales items (menu items) should NOT block on inventory — only purchase items (raw materials) are tracked
      // Stock will still be decremented if available, but going negative is acceptable

      // ─── Adjust stock and create stock transactions ───
      // NOTE: COGS is NOT calculated here. For restaurants, COGS should be based on
      // purchase costs of raw materials, NOT on the costPrice field of sales items.
      // The costPrice of a menu item is not realistic — a meal is assembled from
      // multiple raw materials whose costs can only be accurately tracked through purchases.
      // COGS will be calculated from purchase records at reporting time instead.

      for (const item of invoice.items) {
        if (item.productId) {
          const product = productMap.get(item.productId);
          if (product) {
            if (isReturn) {
              // Return invoice: stock comes BACK in
              await tx.stockTransaction.create({
                data: {
                  productId: item.productId,
                  type: 'RETURN',
                  quantity: item.quantity, // Positive = in
                  costPrice: product.costPrice,
                  totalCost: toNumber(product.costPrice) * toNumber(item.quantity),
                  reference: invoice.invoiceNumber,
                  referenceType: 'POS_INVOICE',
                  referenceId: invoiceId,
                  notes: `فاتورة مرتجع - ${item.name}`,
                  branchId: invoice.branchId,
                },
              });

              // Increment product stock for returns
              await tx.product.update({
                where: { id: item.productId },
                data: {
                  currentStock: { increment: item.quantity },
                },
              });
            } else {
              // Normal sale: stock goes out
              await tx.stockTransaction.create({
                data: {
                  productId: item.productId,
                  type: 'SALE',
                  quantity: -item.quantity, // Negative = out
                  costPrice: product.costPrice,
                  totalCost: toNumber(product.costPrice) * toNumber(item.quantity),
                  reference: invoice.invoiceNumber,
                  referenceType: 'POS_INVOICE',
                  referenceId: invoiceId,
                  notes: `فاتورة بيع - ${item.name}`,
                  branchId: invoice.branchId,
                },
              });

              // Decrement product stock for sales
              await tx.product.update({
                where: { id: item.productId },
                data: {
                  currentStock: { decrement: item.quantity },
                },
              });
            }
          }
        }
      }

      // ─── COGS journal entry REMOVED ───
      // COGS is no longer auto-created on sale because:
      // 1. Restaurant meals are assembled from raw materials — the costPrice field
      //    on menu items is NOT a realistic cost basis
      // 2. COGS should be calculated from actual purchase records, not from
      //    estimated per-item costs
      // 3. Inventory value should be: purchases - current stock = estimated COGS
      // This provides a more accurate picture than per-item costPrice estimates

      // Update invoice with customerId if it was missing and provided in request body
      // This ensures the invoice record is consistent with the Transaction
      if (!invoice.customerId && effectiveCustomerId) {
        await tx.pOSInvoice.update({
          where: { id: invoiceId },
          data: {
            customerId: effectiveCustomerId,
            customerName: effectiveCustomerName,
          },
        });
      }

      // Group payments by type (cash vs bank) for accounting
      const cashPayments = resolvedPayments.filter(
        (p) => p.method === 'CASH'
      );
      const bankPayments = resolvedPayments.filter(
        (p) => BANK_PAYMENT_METHODS.includes(p.method as PaymentMethod)
      );

      const creditPayments = resolvedPayments.filter(
        (p) => p.method === CREDIT_PAYMENT_METHOD
      );

      const totalCashAmount = cashPayments.reduce((sum, p) => sum + p.amount, 0);
      const totalBankAmount = bankPayments.reduce((sum, p) => sum + p.amount, 0);
      const totalCreditAmount = creditPayments.reduce((sum, p) => sum + p.amount, 0);

      let accountingEntryId: string | undefined;
      let accountingEntryNumber: string | undefined;
      let transactionId: string | undefined;
      // Track the last (most recent) transaction ID for split payment invoices.
      // KNOWN LIMITATION: POSInvoice.transactionId is a single field, but split payments
      // create multiple accounting Transaction records. We store the last one created,
      // which is typically the credit/platform payment if present. All payment records
      // are stored in POSInvoicePayment for full traceability.
      let lastTransactionId: string | undefined;

      // Create accounting entries based on payment types
      // Each distinct payment method gets its own journal entry
      const totalPaymentAmount = totalCashAmount + totalBankAmount + totalCreditAmount;

      // Helper: calculate proportional amounts for a given ratio
      const calcProportional = (base: number, ratio: number) => Math.round(base * ratio * 100) / 100;

      // Collect all individual payment entries to create
      // Each entry is: { type, method, amount, ratio }
      const paymentEntries: { type: 'SALE_CASH' | 'SALE_BANK' | 'SALE_PLATFORM'; method: string; amount: number }[] = [];

      // One entry per cash payment (usually just one CASH, but support multiple)
      for (const cp of cashPayments) {
        paymentEntries.push({ type: 'SALE_CASH', method: 'CASH', amount: cp.amount });
      }
      // One entry per bank payment method (MADA, VISA, MASTERCARD, OTHER_CARD each get their own)
      for (const bp of bankPayments) {
        paymentEntries.push({ type: 'SALE_BANK', method: bp.method, amount: bp.amount });
      }
      // One entry for credit (usually just one)
      for (const crp of creditPayments) {
        paymentEntries.push({ type: 'SALE_PLATFORM', method: 'CREDIT', amount: crp.amount });
      }

      if (paymentEntries.length > 0) {
        // Calculate ratios for proportional allocation of subtotal/tax/discount
        for (const entry of paymentEntries) {
          const entryRatio = totalPaymentAmount > 0 ? entry.amount / totalPaymentAmount : 0;
          const entryBaseAmount = calcProportional(invoiceSubtotal, entryRatio);
          const entryTaxAmount = calcProportional(invoiceTax, entryRatio);
          const entryDiscount = calcProportional(invoiceDiscount, entryRatio);

          const entryResult = await createTransaction({
            type: entry.type,
            date: new Date(),
            description: entry.type === 'SALE_CASH'
              ? `فاتورة نقطة بيع (نقدي) - ${invoice.invoiceNumber}`
              : entry.type === 'SALE_BANK'
                ? `فاتورة نقطة بيع (${entry.method}) - ${invoice.invoiceNumber}`
                : `فاتورة نقطة بيع (آجل) - ${invoice.invoiceNumber}`,
            amount: entryBaseAmount,
            branchId: invoice.branchId,
            paymentMethod: entry.method as PaymentMethod,
            applyTax: true,
            taxAmount: entryTaxAmount,
            discountAmount: entryDiscount,
            customerId: effectiveCustomerId || undefined,
            counterParty: effectiveCustomerName || (entry.type === 'SALE_PLATFORM' ? 'عميل آجل' : 'عميل نقدي'),
            invoiceNumber: invoice.invoiceNumber,
            status: 'POSTED',
            tx,
          });

          if (!accountingEntryId) {
            accountingEntryId = entryResult.id;
            accountingEntryNumber = entryResult.entryNumber;
          }
          // Always update to the last transaction ID so split payment invoices
          // link to the most recently created transaction (e.g., credit payment)
          if (entryResult.transactionId) {
            lastTransactionId = entryResult.transactionId;
          }
          if (!transactionId && entryResult.transactionId) {
            transactionId = entryResult.transactionId;
          }
        }
      }

      // Create POSInvoicePayment records for each payment
      const paymentRecords = await Promise.all(
        resolvedPayments.map((p) =>
          tx.pOSInvoicePayment.create({
            data: {
              invoiceId,
              method: p.method,
              amount: p.amount,
            },
          })
        )
      );

      // Update the POS invoice with finalized status, payment info, and transaction link
      const finalizedInvoice = await tx.pOSInvoice.update({
        where: { id: invoiceId },
        data: {
          status: isReturn ? 'RETURNED' : 'FINALIZED',
          paidAmount: totalPaid,
          changeAmount,
          paymentMethod: primaryPaymentMethod,
          transactionId: lastTransactionId || transactionId || null,
          // Also ensure customerId is saved on the invoice if it was provided via request body
          ...(effectiveCustomerId && !invoice.customerId ? {
            customerId: effectiveCustomerId,
            customerName: effectiveCustomerName,
          } : {}),
        },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true, phone: true } },
          table: { select: { id: true, name: true } },
          payments: true,
          transaction: {
            select: {
              id: true,
              transactionNumber: true,
              type: true,
              subType: true,
              status: true,
              netAmount: true,
            },
          },
        },
      });

      return {
        invoice: finalizedInvoice,
        paymentRecords,
        accountingEntryId,
        accountingEntryNumber,
      };
    }, {
      maxWait: 10000,
      timeout: 20000,
    });

    const { invoice: finalizedInvoice, paymentRecords, accountingEntryId, accountingEntryNumber } = result;

    // Audit log the finalize event (non-blocking)
    if (auth.authenticated) {
      auditFinalize(
        'POS_INVOICE',
        finalizedInvoice.id,
        finalizedInvoice.invoiceNumber,
        `إنهاء فاتورة: ${finalizedInvoice.invoiceNumber} - المبلغ: ${toNumber(finalizedInvoice.totalAmount)}`,
        auth.userId,
        auth.email,
        auth.role,
        finalizedInvoice.branchId as string | undefined
      ).catch(() => {});
    }

    return NextResponse.json({
      id: finalizedInvoice.id,
      invoiceNumber: finalizedInvoice.invoiceNumber,
      tableId: finalizedInvoice.tableId,
      table: finalizedInvoice.table,
      branchId: finalizedInvoice.branchId,
      status: finalizedInvoice.status,
      customerId: finalizedInvoice.customerId,
      customerName: finalizedInvoice.customerName,
      customer: finalizedInvoice.customer,
      subtotal: toNumber(finalizedInvoice.subtotal),
      discountPercentage: toNumber(finalizedInvoice.discountPercentage),
      discountAmount: toNumber(finalizedInvoice.discountAmount),
      taxAmount: toNumber(finalizedInvoice.taxAmount),
      totalAmount: toNumber(finalizedInvoice.totalAmount),
      paidAmount: toNumber(finalizedInvoice.paidAmount),
      changeAmount: toNumber(finalizedInvoice.changeAmount),
      paymentMethod: finalizedInvoice.paymentMethod,
      transactionId: finalizedInvoice.transactionId,
      transaction: finalizedInvoice.transaction
        ? {
            ...finalizedInvoice.transaction,
            netAmount: toNumber(finalizedInvoice.transaction.netAmount),
          }
        : null,
      notes: finalizedInvoice.notes,
      items: finalizedInvoice.items.map((item: any) => ({
        ...item,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        totalPrice: toNumber(item.totalPrice),
      })),
      payments: finalizedInvoice.payments.map((p: any) => ({
        ...p,
        amount: toNumber(p.amount),
      })),
      accountingEntryId,
      accountingEntryNumber,
      createdAt: finalizedInvoice.createdAt.toISOString(),
      updatedAt: finalizedInvoice.updatedAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error finalizing invoice:', error);
    return NextResponse.json(
      { error: 'فشل في إنهاء الفاتورة' },
      { status: 500 }
    );
  }
}
