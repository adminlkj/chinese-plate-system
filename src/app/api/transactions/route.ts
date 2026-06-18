import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, safePageSize, checkReadAccess } from '@/lib/api-auth';

// GET /api/transactions - List all transactions with their journal entries
// List view uses lightweight _count instead of deep nested includes
// For full journal entry details with accounts, use the single-transaction endpoint
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'transactions'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const customerId = searchParams.get('customerId');
    const supplierId = searchParams.get('supplierId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        include: {
          _count: { select: { journalEntries: true } },
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          parentTransaction: { select: { id: true, transactionNumber: true, type: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.transaction.count({ where }),
    ]);

    return NextResponse.json({
      transactions: transactions.map(t => ({
        id: t.id,
        transactionNumber: t.transactionNumber,
        type: t.type,
        subType: t.subType,
        date: t.date.toISOString(),
        description: t.description,
        referenceCode: t.referenceCode,
        branch: t.branchId,
        customerId: t.customerId,
        supplierId: t.supplierId,
        totalAmount: toNumber(t.totalAmount),
        taxAmount: toNumber(t.taxAmount),
        discountAmount: toNumber(t.discountAmount),
        netAmount: toNumber(t.netAmount),
        status: t.status,
        paymentMethod: t.paymentMethod,
        counterParty: t.counterParty,
        invoiceNumber: t.invoiceNumber,
        parentTransactionId: t.parentTransactionId,
        parentTransactionNumber: t.parentTransaction?.transactionNumber,
        customerName: t.customer?.name,
        supplierName: t.supplier?.name,
        journalEntryCount: t._count.journalEntries,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'فشل في جلب العمليات' }, { status: 500 });
  }
}
