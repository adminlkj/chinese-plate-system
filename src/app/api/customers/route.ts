import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, checkWriteAccess, checkReadAccess, sanitizeInput, getAccessGrantingContext } from '@/lib/api-auth';
import { toNumber } from '@/lib/decimal';
import { Prisma } from '@prisma/client';
import { auditLog } from '@/lib/audit-log';

// GET /api/customers - List customers with computed balances (paginated)
// Context-aware: POS users get READ access via POS_CONTEXT (Layer 2)
// OPTIMIZED: Uses batch aggregation queries instead of N+1 per-customer queries.
// Balance = Sum of SALE_PLATFORM netAmount - Sum of SALE_RETURN_PLATFORM netAmount - Sum of COLLECTION totalAmount
// Query params: search (name/phone filter), limit (default 100), offset (default 0)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    // checkReadAccess now supports context: if user has POS access but not explicit customers READ,
    // the POS_CONTEXT (Layer 2) will grant READ access for customer listing within POS
    const readCheck = checkReadAccess(auth, 'customers', 'pos'); if (!readCheck.authenticated) return readCheck.response;

    // Audit: Log if access was granted via context (Layer 2) rather than explicit permission (Layer 1)
    if (process.env.NODE_ENV === 'development') {
      const grantingContext = getAccessGrantingContext(auth, 'customers');
      if (grantingContext) {
        console.log(`[PERM] User ${auth.email} accessed customers via ${grantingContext.id} context (${grantingContext.labelAr})`);
      }
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100') || 100, 500);
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

    const [customers, total] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
      }),
      db.customer.count({ where }),
    ]);

    // OPTIMIZED: Batch aggregation for all customer balances in 3 queries instead of N*3
    const customerIds = customers.map(c => c.id);

    // Batch 1: Sum of SALE_PLATFORM netAmount grouped by customerId
    const salesAgg = customerIds.length > 0 ? await db.transaction.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        type: 'SALE',
        subType: 'PLATFORM',
        status: 'POSTED',
      },
      _sum: { netAmount: true },
    }) as any[] : [];

    // Batch 2: Sum of SALE_RETURN_PLATFORM netAmount grouped by customerId
    const returnsAgg = customerIds.length > 0 ? await db.transaction.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        type: 'SALE_RETURN',
        subType: 'RETURN_PLATFORM',
        status: 'POSTED',
      },
      _sum: { netAmount: true },
    }) as any[] : [];

    // Batch 3: Sum of COLLECTION totalAmount grouped by customerId
    const collectionsAgg = customerIds.length > 0 ? await db.transaction.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: customerIds },
        type: 'COLLECTION',
        status: 'POSTED',
      },
      _sum: { totalAmount: true },
    }) as any[] : [];

    // Build lookup maps
    const salesMap = new Map(salesAgg.map(s => [s.customerId, toNumber(s._sum.netAmount)]));
    const returnsMap = new Map(returnsAgg.map(s => [s.customerId, toNumber(s._sum.netAmount)]));
    const collectionsMap = new Map(collectionsAgg.map(s => [s.customerId, toNumber(s._sum.totalAmount)]));

    // Calculate balances from batch data
    const customersWithBalance = customers.map(customer => {
      const totalSales = salesMap.get(customer.id) || 0;
      const totalReturns = returnsMap.get(customer.id) || 0;
      const totalCollections = collectionsMap.get(customer.id) || 0;
      const balance = totalSales - totalReturns - totalCollections;

      return {
        ...customer,
        discountPercentage: toNumber(customer.discountPercentage),
        balance,
        totalSales,
        totalCollections,
        totalArDebit: totalSales,
        totalArCredit: totalCollections,
      };
    });

    return NextResponse.json({ customers: customersWithBalance, total, limit, offset });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json({ error: 'فشل في جلب العملاء' }, { status: 500 });
  }
}

// POST /api/customers - Create a customer
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'customers'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { name, nameEn, type, phone, email, discountPercentage } = body;

    const sanitizedName = sanitizeInput(name);
    if (!sanitizedName) {
      return NextResponse.json({ error: 'اسم العميل مطلوب' }, { status: 400 });
    }

    const customer = await db.customer.create({
      data: {
        name: sanitizedName,
        nameEn: nameEn ? sanitizeInput(nameEn) : null,
        type: type || 'PLATFORM',
        discountPercentage: discountPercentage ? new Prisma.Decimal(discountPercentage) : new Prisma.Decimal(0),
        phone: phone || null,
        email: email || null,
        balance: 0,
        isActive: true,
      },
    });

    // AUDIT-9-18 — customer creation (INFO)
    auditLog({
      action: 'CREATE',
      entity: 'CUSTOMER',
      entityId: customer.id,
      description: `إنشاء عميل: ${customer.name}${customer.phone ? ` - ${customer.phone}` : ''}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
      details: { name: customer.name, type: customer.type, phone: customer.phone, email: customer.email },
    }).catch(() => {});

    return NextResponse.json({
      ...customer,
      discountPercentage: toNumber(customer.discountPercentage),
      balance: toNumber(customer.balance),
    });
  } catch (error: any) {
    console.error('[POST /api/customers]', error);
    // Handle unique constraint violations (e.g., duplicate phone) with 409 Conflict
    if (error.code === 'P2002') {
      const fields = error.meta?.target?.join(', ') || 'الحقول الفريدة';
      return NextResponse.json({ error: `قيمة مكررة في ${fields}` }, { status: 409 });
    }
    return NextResponse.json({ error: 'فشل في إنشاء العميل' }, { status: 500 });
  }
}
