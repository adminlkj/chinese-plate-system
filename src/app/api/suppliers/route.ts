import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput, safePageSize } from '@/lib/api-auth';
import { toNumber } from '@/lib/decimal';
import { auditLog } from '@/lib/audit-log';

// GET /api/suppliers - List all suppliers with computed balances (paginated, batch-aggregated)
// Uses Transaction-based calculation for accurate payables:
// - Total Purchases = Sum of netAmount from PURCHASE transactions (POSTED)
// - Total Payments = Sum of totalAmount from PAYMENT transactions (POSTED)
// - Balance = Total Purchases - Total Payments
//
// AUDIT-9-18 (Phase 18): Replaced N+1 Promise.all(suppliers.map(s => getSupplierPayables(s.id)))
// with 3 batch groupBy queries — O(1) DB round-trips regardless of supplier count.
// (Prior AUDIT-7-17 worklog claimed this was fixed; the fix was not present in the committed code.)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'suppliers'); if (!readCheck.authenticated) return readCheck.response;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const limit = safePageSize(parseInt(searchParams.get('limit') || '500'), 500, 500);
    const offset = parseInt(searchParams.get('offset') || '0') || 0;

    const where: any = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { nameEn: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      db.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      db.supplier.count({ where }),
    ]);

    // OPTIMIZED: Batch aggregation — 3 queries total regardless of supplier count
    const supplierIds = suppliers.map((s) => s.id);

    const [purchasesAgg, paymentsAgg, returnsAgg] = await Promise.all([
      supplierIds.length > 0
        ? db.transaction.groupBy({
            by: ['supplierId'],
            where: {
              supplierId: { in: supplierIds },
              type: 'PURCHASE',
              status: 'POSTED',
            },
            _sum: { netAmount: true },
          })
        : Promise.resolve([]),
      supplierIds.length > 0
        ? db.transaction.groupBy({
            by: ['supplierId'],
            where: {
              supplierId: { in: supplierIds },
              type: 'PAYMENT',
              status: 'POSTED',
            },
            _sum: { totalAmount: true },
          })
        : Promise.resolve([]),
      supplierIds.length > 0
        ? db.transaction.groupBy({
            by: ['supplierId'],
            where: {
              supplierId: { in: supplierIds },
              type: 'PURCHASE_RETURN',
              status: 'POSTED',
            },
            _sum: { netAmount: true },
          })
        : Promise.resolve([]),
    ]);

    const purchasesMap = new Map(
      (purchasesAgg as any[]).map((s) => [s.supplierId, toNumber(s._sum.netAmount)])
    );
    const paymentsMap = new Map(
      (paymentsAgg as any[]).map((s) => [s.supplierId, toNumber(s._sum.totalAmount)])
    );
    const returnsMap = new Map(
      (returnsAgg as any[]).map((s) => [s.supplierId, toNumber(s._sum.netAmount)])
    );

    const suppliersWithBalance = suppliers.map((supplier) => {
      const totalPurchases = purchasesMap.get(supplier.id) || 0;
      const totalPayments = paymentsMap.get(supplier.id) || 0;
      const totalReturns = returnsMap.get(supplier.id) || 0;
      // Balance = Purchases - Returns - Payments (consistent with getSupplierPayables)
      const balance = totalPurchases - totalReturns - totalPayments;
      return {
        ...supplier,
        balance,
        totalPurchases,
        totalPayments,
        totalReturns,
      };
    });

    // Preserve backward-compat response shape: the frontend (suppliers.tsx, transaction-entry.tsx,
    // advanced-reports.tsx) expects a bare JSON array, not a {suppliers, total, ...} envelope.
    return NextResponse.json(suppliersWithBalance);
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return NextResponse.json({ error: 'فشل في جلب الموردين' }, { status: 500 });
  }
}

// POST /api/suppliers - Create a supplier
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'suppliers'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { name, nameEn, phone, email } = body;

    const sanitizedName = sanitizeInput(name);
    if (!sanitizedName) {
      return NextResponse.json({ error: 'اسم المورد مطلوب' }, { status: 400 });
    }

    const supplier = await db.supplier.create({
      data: {
        name: sanitizedName,
        nameEn: nameEn ? sanitizeInput(nameEn) : null,
        phone: phone || null,
        email: email || null,
        balance: 0,
        isActive: true,
      },
    });

    // AUDIT-9-18 — supplier creation (INFO)
    auditLog({
      action: 'CREATE',
      entity: 'SUPPLIER',
      entityId: supplier.id,
      description: `إنشاء مورد: ${supplier.name}${supplier.phone ? ` - ${supplier.phone}` : ''}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { name: supplier.name, phone: supplier.phone, email: supplier.email },
    }).catch(() => {});

    return NextResponse.json({
      ...supplier,
      balance: toNumber(supplier.balance),
    });
  } catch (error: any) {
    console.error('[POST /api/suppliers]', error);
    // Handle unique constraint violations (e.g., duplicate phone) with 409 Conflict
    if (error.code === 'P2002') {
      const fields = error.meta?.target?.join(', ') || 'الحقول الفريدة';
      return NextResponse.json({ error: `قيمة مكررة في ${fields}` }, { status: 409 });
    }
    return NextResponse.json({ error: 'فشل في إنشاء المورد' }, { status: 500 });
  }
}
