import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cancelJournalEntry, postJournalEntry, unpostJournalEntry, updateAccountBalance, recalculateAllBalances } from '@/lib/accounting-engine';
import { toNumber } from '@/lib/decimal';
import { requireAuth, checkWriteAccess, checkReadAccess } from '@/lib/api-auth';
import { auditLog } from '@/lib/audit-log';

// GET /api/journal-entries/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const readCheck = checkReadAccess(auth, 'journal'); if (!readCheck.authenticated) return readCheck.response;
    const { id } = await params;
    const entry = await db.journalEntry.findUnique({
      where: { id },
      include: { lines: { include: { account: true } } },
    });

    if (!entry) {
      return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 });
    }

    return NextResponse.json({
      ...entry,
      amount: toNumber(entry.amount),
      taxAmount: toNumber(entry.taxAmount),
      discountAmount: toNumber(entry.discountAmount),
      totalAmount: toNumber(entry.totalAmount),
      date: entry.date.toISOString(),
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      lines: entry.lines.map(l => ({
        id: l.id,
        accountId: l.accountId,
        accountCode: l.account.code,
        accountName: l.account.name,
        debit: toNumber(l.debit),
        credit: toNumber(l.credit),
        description: l.description,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'فشل في جلب القيد' }, { status: 500 });
  }
}

// PUT /api/journal-entries/[id] - Update entry (status change, edit draft)
// All multi-step operations are WRAPPED IN $transaction for atomicity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const isAdmin = auth.role === 'ADMIN';
    // Admin has absolute power — skip write access check for admin
    if (!isAdmin) {
      const writeCheck = checkWriteAccess(auth, 'journal'); if (!writeCheck.authenticated) return writeCheck.response;
    }
    const { id } = await params;
    const body = await request.json();
    const { action, description, date, lines } = body;

    if (action === 'cancel') {
      await cancelJournalEntry(id); // Already wrapped in $transaction internally
      // AUDIT-9-18: Audit log the cancel action (WARNING — financial reversal)
      auditLog({
        action: 'UPDATE',
        entity: 'JOURNAL_ENTRY',
        entityId: id,
        description: `إلغاء القيد ${id}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'WARNING',
        category: 'ACCOUNTING',
        details: { action: 'cancel' },
      }).catch(() => {});
      return NextResponse.json({ success: true, message: 'تم إلغاء القيد' });
    }

    if (action === 'post') {
      await postJournalEntry(id); // Already wrapped in $transaction internally
      auditLog({
        action: 'UPDATE',
        entity: 'JOURNAL_ENTRY',
        entityId: id,
        description: `ترحيل القيد ${id}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'INFO',
        category: 'ACCOUNTING',
        details: { action: 'post' },
      }).catch(() => {});
      return NextResponse.json({ success: true, message: 'تم ترحيل القيد' });
    }

    if (action === 'unpost') {
      await unpostJournalEntry(id); // Already wrapped in $transaction internally
      auditLog({
        action: 'UPDATE',
        entity: 'JOURNAL_ENTRY',
        entityId: id,
        description: `إرجاع القيد ${id} لمسودة`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'WARNING',
        category: 'ACCOUNTING',
        details: { action: 'unpost' },
      }).catch(() => {});
      return NextResponse.json({ success: true, message: 'تم إرجاع القيد لمسودة' });
    }

    // Edit entry - WRAPPED IN $transaction for atomicity
    // ADMIN can edit any entry status (DRAFT, POSTED, CANCELLED)
    // Non-admin users can only edit DRAFT entries
    const result = await db.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true },
      });

      if (!entry) {
        throw new Error('القيد غير موجود');
      }

      if (entry.status !== 'DRAFT' && !isAdmin) {
        throw new Error('لا يمكن تعديل قيد مرحّل أو ملغي - فقط مدير النظام يمكنه ذلك');
      }

      // Delete old lines and create new ones - all within the same transaction
      if (lines && lines.length > 0) {
        const oldAccountIds = entry.lines.map(l => l.accountId);

        await tx.journalLine.deleteMany({ where: { journalEntryId: id } });

        await tx.journalEntry.update({
          where: { id },
          data: {
            description: description || entry.description,
            date: date ? new Date(date) : entry.date,
            lines: {
              create: lines.map((l: any) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                description: l.description,
              })),
            },
          },
          include: { lines: true },
        });

        // Recalculate balances for all affected accounts.
        // For DRAFT entries this is a safety measure (DRAFT doesn't affect balances).
        // For POSTED entries edited by admin, this is critical to keep balances in sync
        // since getAccountBalance() counts POSTED entries and lines may have changed.
        const newAccountIds = lines.map((l: any) => l.accountId);
        const allAccountIds = [...new Set([...oldAccountIds, ...newAccountIds])];
        for (const accId of allAccountIds) {
          await updateAccountBalance(accId, tx);
        }
      } else {
        await tx.journalEntry.update({
          where: { id },
          data: {
            description: description || entry.description,
            date: date ? new Date(date) : entry.date,
          },
        });
      }

      return { success: true, message: 'تم تحديث القيد' };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    const isValidationError =
      error.message?.includes('لا يمكن تعديل') ||
      error.message?.includes('لا يمكن') ||
      error.message?.includes('غير موجود');
    const status = isValidationError ? 400 : 500;
    console.error('[PUT /api/journal-entries/[id]]', error);
    return NextResponse.json(
      { error: isValidationError ? error.message : 'فشل في تحديث القيد' },
      { status }
    );
  }
}

// DELETE /api/journal-entries/[id] - Delete an entry
// AUDIT-9-18: For POSTED entries, this is now a SOFT-VOID (cancel) — preserves the audit
// trail. Previously this did a hard delete + cascade-delete of the entire linked POS
// invoice (including payments, items, stock transactions), which destroyed financial
// history. The cascade-delete has been removed.
//
// Behavior:
//   - DRAFT entries: hard delete (no accounting impact, no audit trail to preserve).
//   - POSTED entries (admin only): redirect to cancelJournalEntry() — sets status to
//     CANCELLED, recalculates affected balances, cancels sibling JEs in the same
//     Transaction. The row + lines remain in the DB for audit.
//   - CANCELLED entries (admin only): hard delete (the row is already neutralized).
//
// The previous cascade-delete of linked POS invoices is REMOVED — invoices can be
// voided via /api/pos/invoices/[id] if needed.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(); if (!auth.authenticated) return auth.response;
    const isAdmin = auth.role === 'ADMIN';
    // Admin has absolute power — skip write access check for admin
    if (!isAdmin) {
      const writeCheck = checkWriteAccess(auth, 'journal'); if (!writeCheck.authenticated) return writeCheck.response;
    }
    const { id } = await params;

    // First peek at the entry to choose the right strategy
    const peek = await db.journalEntry.findUnique({
      where: { id },
      select: { id: true, status: true, entryNumber: true, description: true, transactionId: true, invoiceNumber: true },
    });
    if (!peek) {
      return NextResponse.json({ error: 'القيد غير موجود' }, { status: 404 });
    }

    // POSTED entries: SOFT-VOID via cancelJournalEntry (preserves audit trail).
    // AUDIT-9-18 fix.
    if (peek.status === 'POSTED') {
      if (!isAdmin) {
        return NextResponse.json(
          { error: 'لا يمكن حذف قيد مرحّل - فقط مدير النظام يمكنه ذلك' },
          { status: 400 }
        );
      }
      await cancelJournalEntry(id);
      auditLog({
        action: 'DELETE',
        entity: 'JOURNAL_ENTRY',
        entityId: id,
        entityNumber: peek.entryNumber,
        description: `Soft-void (cancel) POSTED journal entry ${peek.entryNumber}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'CRITICAL',
        category: 'ACCOUNTING',
        details: { previousStatus: 'POSTED', newStatus: 'CANCELLED', transactionId: peek.transactionId },
      }).catch(() => {});
      return NextResponse.json({ success: true, message: 'تم إلغاء القيد المرحّل (soft-void)' });
    }

    // CANCELLED entries (admin only): hard delete — the row is already neutralized
    if (peek.status === 'CANCELLED') {
      if (!isAdmin) {
        return NextResponse.json(
          { error: 'لا يمكن حذف قيد ملغي' },
          { status: 400 }
        );
      }
      await db.$transaction(async (tx) => {
        await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
        await tx.journalEntry.delete({ where: { id } });
      });
      auditLog({
        action: 'DELETE',
        entity: 'JOURNAL_ENTRY',
        entityId: id,
        entityNumber: peek.entryNumber,
        description: `Hard-deleted CANCELLED journal entry ${peek.entryNumber}`,
        userId: auth.userId,
        userName: auth.email,
        userRole: auth.role,
        severity: 'INFO',
        category: 'ACCOUNTING',
      }).catch(() => {});
      return NextResponse.json({ success: true, message: 'تم حذف القيد الملغي' });
    }

    // DRAFT entries: hard delete (no accounting impact)
    await db.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!entry) throw new Error('القيد غير موجود');
      if (entry.status !== 'DRAFT') {
        throw new Error('لا يمكن حذف قيد غير مسودة - استخدم إلغاء (cancel) بدلاً من ذلك');
      }

      const affectedAccountIds = entry.lines.map(l => l.accountId);
      const entryTransactionId = entry.transactionId;

      await tx.journalLine.deleteMany({ where: { journalEntryId: id } });
      await tx.journalEntry.delete({ where: { id } });

      // Recalculate balances for any accounts (DRAFT normally doesn't affect balances,
      // but this is a safety measure for any edge case)
      for (const accId of new Set(affectedAccountIds)) {
        if (typeof accId === 'string') {
          await updateAccountBalance(accId, tx);
        }
      }

      // Delete the associated Transaction header if it has no remaining journal entries
      if (entryTransactionId) {
        const remainingJEsInTransaction = await tx.journalEntry.count({
          where: { transactionId: entryTransactionId },
        });
        if (remainingJEsInTransaction === 0) {
          try {
            await tx.transaction.delete({ where: { id: entryTransactionId } });
          } catch {
            // Transaction may already be deleted — continue gracefully
          }
        }
      }
    });

    // Recalculate all account balances after the transaction completes
    await recalculateAllBalances();

    auditLog({
      action: 'DELETE',
      entity: 'JOURNAL_ENTRY',
      entityId: id,
      entityNumber: peek.entryNumber,
      description: `Hard-deleted DRAFT journal entry ${peek.entryNumber}`,
      userId: auth.userId,
      userName: auth.email,
      userRole: auth.role,
      severity: 'INFO',
      category: 'ACCOUNTING',
    }).catch(() => {});

    return NextResponse.json({ success: true, message: 'تم حذف القيد' });
  } catch (error: any) {
    const isValidationError =
      error.message?.includes('لا يمكن حذف') ||
      error.message?.includes('لا يمكن') ||
      error.message?.includes('غير موجود');
    const status = isValidationError ? 400 : 500;
    console.error('[DELETE /api/journal-entries/[id]]', error);
    return NextResponse.json(
      { error: isValidationError ? error.message : 'فشل في حذف القيد' },
      { status }
    );
  }
}
