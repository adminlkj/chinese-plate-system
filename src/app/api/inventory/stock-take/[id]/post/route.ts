import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber, round2 } from '@/lib/decimal';
import { requireRole, checkWriteAccess, assertBranchAccess } from '@/lib/api-auth';
import {
  generateEntryNumber,
  generateTransactionNumber,
  updateAccountBalance,
  type PrismaTransaction,
} from '@/lib/accounting-engine';
import { auditLog } from '@/lib/audit-log';
// POST /api/inventory/stock-take/[id]/post — Finalize/post a stock take
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireRole('ADMIN');
    if (!auth.authenticated) return auth.response;

    const writeCheck = checkWriteAccess(auth, 'products-inventory'); if (!writeCheck.authenticated) return writeCheck.response;

    const { id } = await params;

    // Fetch the stock take with all items
    const stockTake = await db.stockTake.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, nameEn: true, sku: true },
            },
          },
        },
      },
    });

    if (!stockTake) {
      return NextResponse.json(
        { error: 'جرد المخزون غير موجود' },
        { status: 404 }
      );
    }

    if (stockTake.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'يجب إكمال الجرد أولاً قبل الترحيل - فقط الحالة "مكتمل" يمكن ترحيلها' },
        { status: 400 }
      );
    }

    // Verify the user has access to this stock take's branch
    const branchCheck = assertBranchAccess(auth, stockTake.branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Verify all items have been counted
    const uncounted = stockTake.items.filter((item) => item.countedQty === null);
    if (uncounted.length > 0) {
      return NextResponse.json(
        { error: `يوجد ${uncounted.length} منتجات لم يتم عدّها بعد` },
        { status: 400 }
      );
    }

    // Filter items with non-zero differences
    const itemsWithDiff = stockTake.items.filter(
      (item) => Math.abs(toNumber(item.difference)) > 0.001
    );

    if (itemsWithDiff.length === 0) {
      // No adjustments needed — just mark as posted
      const result = await db.stockTake.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedBy: auth.userId,
        },
      });

      return NextResponse.json({
        id: result.id,
        number: result.number,
        status: result.status,
        message: 'تم ترحيل الجرد بنجاح - لا توجد فروقات لتعديلها',
        adjustmentsCount: 0,
      });
    }

    // Execute the entire posting in a single transaction
    const result = await db.$transaction(
      async (tx) => {
        // ─── 1. Create Stock Transactions & Update Product Stock ──────────
        for (const item of itemsWithDiff) {
          const difference = toNumber(item.difference);
          const costPrice = toNumber(item.costPrice);

          // Create stock transaction
          await tx.stockTransaction.create({
            data: {
              productId: item.productId,
              type: 'STOCK_TAKE',
              quantity: difference, // positive = surplus, negative = shortage
              costPrice,
              totalCost: round2(Math.abs(difference * costPrice)),
              reference: stockTake.number,
              referenceType: 'STOCK_TAKE',
              referenceId: stockTake.id,
              notes: `جرد مخزون ${stockTake.number} - ${item.product.name}`,
              branchId: stockTake.branchId,
            },
          });

          // Update product current stock
          await tx.product.update({
            where: { id: item.productId },
            data: {
              currentStock: { increment: difference },
            },
          });
        }

        // ─── 2. Create Accounting Journal Entry ──────────────────────────
        // Calculate total surplus value (positive differences) and shortage value (negative)
        let totalSurplusValue = 0; // Inventory gain
        let totalShortageValue = 0; // Inventory loss

        for (const item of itemsWithDiff) {
          const diff = toNumber(item.difference);
          const value = toNumber(item.totalValue);
          if (diff > 0) {
            totalSurplusValue = round2(totalSurplusValue + value);
          } else {
            totalShortageValue = round2(totalShortageValue + Math.abs(value));
          }
        }

        // Find key accounts
        const inventoryAccount = await tx.account.findFirst({ where: { code: '1300' } });
        const cogsAccount = await tx.account.findFirst({ where: { code: '5950' } });
        // For surplus: look for 4900 (Other Revenue) first, fallback to 4400 (Discount Received)
        let otherRevenueAccount = await tx.account.findFirst({ where: { code: '4900' } });
        if (!otherRevenueAccount) {
          otherRevenueAccount = await tx.account.findFirst({ where: { code: '4400' } });
        }

        if (!inventoryAccount) {
          throw new Error('حساب المخزون (1300) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
        }
        if (totalShortageValue > 0 && !cogsAccount) {
          throw new Error('حساب تكلفة البضاعة المباعة (5950) غير موجود. يجب تهيئة شجرة الحسابات أولاً.');
        }
        if (totalSurplusValue > 0 && !otherRevenueAccount) {
          throw new Error('حساب الإيرادات الأخرى غير موجود. يجب إنشاء حساب 4900 (إيرادات أخرى) أو التأكد من وجود حساب 4400.');
        }

        // Get or create current fiscal period
        let period = await tx.fiscalPeriod.findFirst({ where: { status: 'OPEN' } });
        if (!period) {
          period = await tx.fiscalPeriod.create({
            data: {
              name: 'الفترة الحالية',
              startDate: new Date(new Date().getFullYear(), 0, 1),
              endDate: new Date(new Date().getFullYear(), 11, 31),
              status: 'OPEN',
            },
          });
        }

        // Build journal lines based on surplus/shortage
        const journalLines: { accountId: string; debit: number; credit: number; description: string }[] = [];

        if (totalSurplusValue > 0) {
          // Surplus: Debit Inventory (increase asset), Credit Other Revenue (record gain)
          journalLines.push({
            accountId: inventoryAccount.id,
            debit: totalSurplusValue,
            credit: 0,
            description: `زيادة مخزون من الجرد ${stockTake.number}`,
          });
          journalLines.push({
            accountId: otherRevenueAccount!.id,
            debit: 0,
            credit: totalSurplusValue,
            description: `إيراد فائض مخزون من الجرد ${stockTake.number}`,
          });
        }

        if (totalShortageValue > 0) {
          // Shortage: Debit COGS/Loss (record loss), Credit Inventory (decrease asset)
          journalLines.push({
            accountId: cogsAccount!.id,
            debit: totalShortageValue,
            credit: 0,
            description: `نقص مخزون من الجرد ${stockTake.number}`,
          });
          journalLines.push({
            accountId: inventoryAccount.id,
            debit: 0,
            credit: totalShortageValue,
            description: `تخفيض مخزون بسبب النقص من الجرد ${stockTake.number}`,
          });
        }

        // Validate balanced entry
        const totalDebit = round2(journalLines.reduce((s, l) => round2(s + l.debit), 0));
        const totalCredit = round2(journalLines.reduce((s, l) => round2(s + l.credit), 0));
        if (Math.abs(totalDebit - totalCredit) >= 0.005) {
          throw new Error(`القيد غير متوازن - المدين: ${totalDebit} والدائن: ${totalCredit}`);
        }

        // Generate numbers
        const entryNumber = await generateEntryNumber(tx);
        const transactionNumber = await generateTransactionNumber(tx);

        // Create Transaction header
        const totalAmount = round2(totalSurplusValue + totalShortageValue);
        const transaction = await tx.transaction.create({
          data: {
            transactionNumber,
            type: 'MANUAL',
            subType: null,
            date: stockTake.date,
            description: `تسوية جرد المخزون ${stockTake.number}`,
            referenceCode: stockTake.number,
            branchId: stockTake.branchId,
            totalAmount,
            taxAmount: 0,
            discountAmount: 0,
            netAmount: totalAmount,
            status: 'POSTED',
          },
        });

        // Create Journal Entry
        const entry = await tx.journalEntry.create({
          data: {
            entryNumber,
            date: stockTake.date,
            description: `تسوية جرد المخزون ${stockTake.number}`,
            type: 'MANUAL',
            status: 'POSTED',
            reference: stockTake.number,
            branchId: stockTake.branchId,
            amount: totalAmount,
            taxAmount: 0,
            discountAmount: 0,
            totalAmount: totalAmount,
            periodId: period.id,
            groupId: transaction.transactionNumber,
            groupRole: 'PRIMARY',
            transactionId: transaction.id,
            lines: {
              create: journalLines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                description: l.description,
              })),
            },
          },
          include: { lines: { include: { account: true } } },
        });

        // Update account balances for all posted lines
        for (const line of entry.lines) {
          await updateAccountBalance(line.accountId, tx);
        }

        // ─── 3. Mark Stock Take as POSTED ────────────────────────────────
        const updated = await tx.stockTake.update({
          where: { id },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            postedBy: auth.userId,
          },
        });

        return {
          stockTake: updated,
          adjustmentsCount: itemsWithDiff.length,
          totalSurplusValue,
          totalShortageValue,
          journalEntryNumber: entryNumber,
          transactionNumber,
        };
      },
      {
        maxWait: 10000,
        timeout: 30000,
      }
    );

    // AUDIT-9-18 — stock-take posting is a WARNING (inventory valuation change + accounting JE)
    auditLog({
      action: 'FINALIZE',
      entity: 'STOCK_TAKE',
      entityId: result.stockTake.id,
      entityNumber: result.stockTake.number,
      description: `ترحيل جرد المخزون ${result.stockTake.number} - ${result.adjustmentsCount} تعديلات (فائض: ${result.totalSurplusValue}, نقص: ${result.totalShortageValue})`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId: stockTake.branchId,
      severity: 'WARNING',
      category: 'INVENTORY',
      details: {
        adjustmentsCount: result.adjustmentsCount,
        totalSurplusValue: result.totalSurplusValue,
        totalShortageValue: result.totalShortageValue,
        journalEntryNumber: result.journalEntryNumber,
        transactionNumber: result.transactionNumber,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: result.stockTake.id,
      number: result.stockTake.number,
      status: result.stockTake.status,
      postedAt: result.stockTake.postedAt?.toISOString(),
      postedBy: result.stockTake.postedBy,
      adjustmentsCount: result.adjustmentsCount,
      totalSurplusValue: result.totalSurplusValue,
      totalShortageValue: result.totalShortageValue,
      journalEntryNumber: result.journalEntryNumber,
      transactionNumber: result.transactionNumber,
      message: `تم ترحيل الجرد بنجاح - ${result.adjustmentsCount} تعديلات مخزون`,
    });
  } catch (error: any) {
    console.error('Error posting stock take:', error);
    return NextResponse.json(
      { error: 'فشل في ترحيل جرد المخزون' },
      { status: 500 }
    );
  }
}
