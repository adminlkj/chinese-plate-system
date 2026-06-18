import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createTransaction } from '@/lib/accounting-engine';
import { toNumber } from '@/lib/decimal';
import { requireAuth, safePageSize, checkWriteAccess, checkReadAccess, sanitizeInput } from '@/lib/api-auth';
import { resolveBranchId, getDefaultBranchId } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// GET /api/journal-entries - Get all journal entries
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'journal'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));
    const groupId = searchParams.get('groupId');
    const search = searchParams.get('search');

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (groupId) where.groupId = groupId;
    if (dateFrom || dateTo) {
      where.date = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { entryNumber: { contains: q } },
        { description: { contains: q } },
        { counterParty: { contains: q } },
        { invoiceNumber: { contains: q } },
        { groupId: { contains: q } },
      ];
    }

    const [entries, total] = await Promise.all([
      db.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: true } },
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          transaction: { select: { id: true, transactionNumber: true, type: true, subType: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.journalEntry.count({ where }),
    ]);

    return NextResponse.json({
      entries: entries.map(e => ({
        id: e.id,
        entryNumber: e.entryNumber,
        date: e.date.toISOString(),
        description: e.description,
        type: e.type,
        status: e.status,
        reference: e.reference,
        branch: e.branchId,
        paymentMethod: e.paymentMethod,
        counterParty: e.counterParty,
        invoiceNumber: e.invoiceNumber,
        amount: toNumber(e.amount),
        taxAmount: toNumber(e.taxAmount),
        discountAmount: toNumber(e.discountAmount),
        totalAmount: toNumber(e.totalAmount),
        customerId: e.customerId,
        supplierId: e.supplierId,
        groupId: e.groupId,
        groupRole: e.groupRole,
        transactionId: e.transactionId,
        transactionNumber: e.transaction?.transactionNumber,
        transactionType: e.transaction?.type,
        transactionSubType: e.transaction?.subType,
        customerName: e.customer?.name,
        supplierName: e.supplier?.name,
        lines: e.lines.map(l => ({
          id: l.id,
          accountId: l.accountId,
          accountCode: l.account.code,
          accountName: l.account.name,
          debit: toNumber(l.debit),
          credit: toNumber(l.credit),
          description: l.description,
        })),
        createdAt: e.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return NextResponse.json({ error: 'فشل في جلب القيود' }, { status: 500 });
  }
}

// POST /api/journal-entries - Create a new journal entry
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'journal'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();

    // Validate required fields
    if (!body.date) {
      return NextResponse.json({ error: 'التاريخ مطلوب / Date is required' }, { status: 400 });
    }
    const parsedDate = new Date(body.date);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: 'تاريخ غير صالح / Invalid date' }, { status: 400 });
    }
    if (!body.type) {
      return NextResponse.json({ error: 'نوع القيد مطلوب / Entry type is required' }, { status: 400 });
    }

    // Only MANUAL entries can be created as DRAFT; all other types are auto-posted
    const status = body.type === 'MANUAL' && body.status === 'DRAFT' ? 'DRAFT' as const : undefined;

    // Resolve branchId (UUID) from body.branch (code/name/id) or body.branchId (UUID), else default
    let branchId: string;
    try {
      branchId = body.branch || body.branchId
        ? await resolveBranchId(body.branch || body.branchId)
        : await getDefaultBranchId();
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'الفرع غير صالح' }, { status: 400 });
    }

    const entry = await createTransaction({
      type: body.type,
      date: parsedDate,
      description: sanitizeInput(body.description),
      amount: body.amount,
      branch: branchId as any,
      paymentMethod: body.paymentMethod,
      counterParty: body.counterParty,
      invoiceNumber: body.invoiceNumber,
      reference: body.reference,
      targetAccountId: body.targetAccountId,
      bankAccountId: body.bankAccountId,
      lines: body.lines,
      // Tax and discount
      applyTax: body.applyTax,
      taxAmount: body.taxAmount,
      discountAmount: body.discountAmount,
      // Customer/Supplier links
      customerId: body.customerId,
      supplierId: body.supplierId,
      // For deposit/withdrawal/transfer
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      // Entry status - DRAFT entries do NOT affect account balances
      status,
      // Transaction grouping
      groupId: body.groupId,
      groupRole: body.groupRole,
      // Parent transaction link (e.g., COLLECTION -> original SALE)
      parentTransactionId: body.parentTransactionId,
    });

    // AUDIT-9-18: Audit log the journal entry creation
    auditLog({
      action: 'CREATE',
      entity: 'JOURNAL_ENTRY',
      entityId: (entry as any)?.id,
      entityNumber: (entry as any)?.entryNumber,
      description: `إنشاء قيد محاسبي: ${(entry as any)?.entryNumber || ''} - ${body.type} - ${body.description || ''}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { type: body.type, amount: body.amount, status: status || 'POSTED' },
    }).catch(() => {});

    return NextResponse.json(entry);
  } catch (error: any) {
    console.error('Error creating journal entry:', error);
    // Return 400 for validation errors, 500 for unexpected errors
    const isValidationError =
      error.message?.includes('أكبر من صفر') ||
      error.message?.includes('غير صالح') ||
      error.message?.includes('يجب تحديد') ||
      error.message?.includes('غير متوازن') ||
      error.message?.includes('حساب محدد') ||
      error.message?.includes('غير موجود') ||
      error.message?.includes('سالبة') ||
      error.message?.includes('فترة مغلقة');
    const status = isValidationError ? 400 : 500;
    // Only surface the message for known validation errors (which are intentionally Arabic);
    // hide unexpected/Prisma error.message to avoid leaking schema details.
    return NextResponse.json(
      { error: isValidationError ? error.message : 'فشل في إنشاء القيد' },
      { status }
    );
  }
}
