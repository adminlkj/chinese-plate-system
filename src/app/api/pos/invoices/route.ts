import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toNumber } from '@/lib/decimal';
import { requireAuth, safePageSize, checkWriteAccess, checkReadAccess, sanitizeInput, assertBranchAccess } from '@/lib/api-auth';
import { resolveBranchId, resolveBranchIdOrNull, getEffectiveTaxRate } from '@/lib/branch-resolver';
import { auditLog } from '@/lib/audit-log';

// Helper: Generate next POS invoice number (POS-0001, POS-0002, etc.)
async function generateInvoiceNumber(tx?: any): Promise<string> {
  const client = tx || db;
  // Only look at POS- prefixed invoices to avoid RET- and other prefixes
  const lastInvoice = await client.pOSInvoice.findFirst({
    where: { invoiceNumber: { startsWith: 'POS-' } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });

  if (!lastInvoice) return 'POS-0001';

  const num = parseInt(lastInvoice.invoiceNumber.replace('POS-', ''));
  if (isNaN(num)) throw new Error(`Corrupted entry number: ${lastInvoice.invoiceNumber}`);
  return `POS-${String(num + 1).padStart(4, '0')}`;
}

// GET /api/pos/invoices - List invoices with filters
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'pos'); if (!readCheck.authenticated) return readCheck.response;
    const { searchParams } = new URL(request.url);
    const branchInput = searchParams.get('branch') || searchParams.get('branchId');
    const status = searchParams.get('status');
    const tableId = searchParams.get('tableId');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = safePageSize(parseInt(searchParams.get('pageSize') || '50'));

    const branchId = await resolveBranchIdOrNull(branchInput);

    // Verify branch access if branch filter is specified
    if (branchInput) {
      const branchCheck = assertBranchAccess(auth, branchInput);
      if (!branchCheck.authenticated) return branchCheck.response;
    }

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (status) {
      // Support comma-separated statuses (e.g., "FINALIZED,RETURNED")
      if (status.includes(',')) {
        where.status = { in: status.split(',') };
      } else {
        where.status = status;
      }
    }
    if (tableId) where.tableId = tableId;

    const [invoices, total] = await Promise.all([
      db.pOSInvoice.findMany({
        where,
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true, phone: true } },
          table: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.pOSInvoice.count({ where }),
    ]);

    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        tableId: inv.tableId,
        tableName: inv.table?.name,
        branchId: inv.branchId,
        status: inv.status,
        customerId: inv.customerId,
        customerName: inv.customerName,
        customer: inv.customer,
        subtotal: toNumber(inv.subtotal),
        discountPercentage: toNumber(inv.discountPercentage),
        discountAmount: toNumber(inv.discountAmount),
        taxAmount: toNumber(inv.taxAmount),
        totalAmount: toNumber(inv.totalAmount),
        paymentMethod: inv.paymentMethod,
        transactionId: inv.transactionId,
        isReturn: inv.isReturn,
        originalInvoiceId: inv.originalInvoiceId,
        notes: inv.notes,
        items: inv.items.map((item: any) => ({
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
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الفواتير' },
      { status: 500 }
    );
  }
}

// POST /api/pos/invoices - Create a new draft invoice (items are optional for empty drafts)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const writeCheck = checkWriteAccess(auth, 'pos'); if (!writeCheck.authenticated) return writeCheck.response;
    const body = await request.json();
    const { tableId, customerId, customerName, discountAmount, items, notes, isReturn, originalInvoiceId } = body;
    const sanitizedNotes = notes ? sanitizeInput(notes) : null;
    const sanitizedCustomerName = customerName ? sanitizeInput(customerName) : null;

    const branchId = await resolveBranchId(body.branch || body.branchId);
    if (!branchId) {
      return NextResponse.json(
        { error: 'الفرع مطلوب' },
        { status: 400 }
      );
    }

    // Verify the user has access to this branch (use the resolved UUID)
    const branchCheck = assertBranchAccess(auth, branchId);
    if (!branchCheck.authenticated) return branchCheck.response;

    // Items are optional - allow creating empty draft invoices
    // (needed for POS flow: click table → create draft → add items one by one)
    const hasItems = items && Array.isArray(items) && items.length > 0;

    // Calculate subtotal from items if provided
    // Deduplicate items by productId before creating
    // If the same productId appears multiple times, merge quantities
    let invoiceItems: any[] = [];
    if (hasItems) {
      // --- Batch product lookup (replaces N+1 per-item queries) ---
      // First pass: collect all unique product IDs that need lookup
      const productIdsNeedingLookup = new Set<string>();
      for (const item of items) {
        const pid = item.productId || null;
        if (pid && (!item.name || (item.unitPrice ?? item.price ?? 0) === 0)) {
          productIdsNeedingLookup.add(pid);
        }
      }

      // Single batch query for all needed products
      let productMap = new Map<string, { name: string; nameEn: string | null; price: any; costPrice: any }>();
      if (productIdsNeedingLookup.size > 0) {
        const products = await db.product.findMany({
          where: { id: { in: Array.from(productIdsNeedingLookup) } },
          select: { id: true, name: true, nameEn: true, price: true, costPrice: true },
        });
        for (const p of products) {
          productMap.set(p.id, p);
        }
      }

      // Second pass: merge items using O(1) map lookup
      const merged: Map<string, any> = new Map();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const pid = item.productId || null;
        const quantity = item.quantity ?? 1;
        // Support both 'price' and 'unitPrice' field names (frontend may send either)
        let unitPrice = item.unitPrice ?? item.price ?? 0;
        let name = item.name || null;
        let nameEn = item.nameEn || null;

        // Resolve product name and price from batch-fetched map
        if (pid && (!name || unitPrice === 0)) {
          const product = productMap.get(pid);
          if (product) {
            if (!name) name = product.name;
            if (!nameEn) nameEn = product.nameEn;
            if (unitPrice === 0) unitPrice = toNumber(product.price);
          }
        }

        if (!name) name = 'عنصر';

        if (pid && merged.has(pid)) {
          // Merge: increment quantity, keep latest price
          const existing = merged.get(pid);
          existing.quantity = (existing.quantity ?? 0) + quantity;
          existing.unitPrice = unitPrice; // use latest price
          existing.totalPrice = existing.quantity * existing.unitPrice;
        } else {
          const key = pid || `__manual_${i}`;
          merged.set(key, {
            name: sanitizeInput(name),
            nameEn: nameEn ? sanitizeInput(nameEn) : null,
            productId: pid,
            quantity,
            unitPrice,
            totalPrice: quantity * unitPrice,
            notes: item.notes ? sanitizeInput(item.notes) : null,
            sortOrder: item.sortOrder ?? merged.size,
          });
        }
      }
      invoiceItems = Array.from(merged.values());
    }

    const subtotal = invoiceItems.reduce((sum: number, item: any) => sum + item.totalPrice, 0);
    const discount = discountAmount ?? 0;
    const taxableAmount = subtotal - discount;
    // Use the per-branch tax rate override (branch.taxRate) when set;
    // otherwise fall back to the global taxRate setting, then to 0.15 (15%).
    const globalTaxRateSetting = await db.setting.findUnique({ where: { key: 'taxRate' } });
    const effectiveTaxRate = await getEffectiveTaxRate(branchId, globalTaxRateSetting?.value ?? null);
    const taxAmount = Math.round(taxableAmount * effectiveTaxRate * 100) / 100;
    const totalAmount = Math.round((taxableAmount + taxAmount) * 100) / 100;

    const invoice = await db.$transaction(async (tx) => {
      const invoiceNumber = await generateInvoiceNumber(tx);

      // Resolve customer name from customer record if not provided
      let resolvedCustomerName = sanitizedCustomerName || null;
      if (customerId && !resolvedCustomerName) {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { name: true },
        });
        resolvedCustomerName = customer?.name || null;
      }

      const invoice = await tx.pOSInvoice.create({
        data: {
          invoiceNumber,
          tableId: tableId || null,
          branchId,
          status: 'DRAFT',
          customerId: customerId || null,
          customerName: resolvedCustomerName,
          isReturn: isReturn === true,
          originalInvoiceId: originalInvoiceId || null,
          subtotal,
          discountAmount: discount,
          taxAmount,
          totalAmount,
          notes: sanitizedNotes,
          items: hasItems
            ? { create: invoiceItems }
            : undefined,
        },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          customer: { select: { id: true, name: true, phone: true } },
          table: { select: { id: true, name: true } },
        },
      });

      return invoice;
    });

    // AUDIT-9-18: Audit log POS invoice (draft) creation
    auditLog({
      action: 'CREATE',
      entity: 'POS_INVOICE',
      entityId: invoice.id,
      entityNumber: invoice.invoiceNumber,
      description: `إنشاء فاتورة ${invoice.invoiceNumber} (${invoice.status}) - المبلغ: ${toNumber(invoice.totalAmount)}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      branchId,
      severity: 'INFO',
      category: 'POS',
      details: {
        itemCount: invoice.items?.length || 0,
        totalAmount: toNumber(invoice.totalAmount),
        isReturn: invoice.isReturn,
        customerId: invoice.customerId || null,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      tableId: invoice.tableId,
      tableName: invoice.table?.name,
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
    });
  } catch (error: any) {
    console.error('Error creating invoice:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الفاتورة' },
      { status: 500 }
    );
  }
}
