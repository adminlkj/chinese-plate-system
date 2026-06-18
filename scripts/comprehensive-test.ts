/**
 * Comprehensive QA Test Script
 * Tests the core business logic directly via Prisma/Accounting Engine
 * Bypasses the HTTP server to avoid Turbopack/memory issues in sandbox
 */

import { db } from '../src/lib/db';
import { createTransaction, recalculateAllBalances, generateEntryNumber, generateTransactionNumber } from '../src/lib/accounting-engine';
import { generateZatcaQR } from '../src/lib/zatca-qr';
import { round2, toNumber } from '../src/lib/decimal';
import type { JournalEntryType, Branch, PaymentMethod } from '../src/lib/types';

let testsPassed = 0;
let testsFailed = 0;
let errors: { test: string; error: string }[] = [];

function assert(condition: boolean, test: string, detail?: string) {
  if (condition) {
    testsPassed++;
    console.log(`  ✅ ${test}${detail ? ` — ${detail}` : ''}`);
  } else {
    testsFailed++;
    errors.push({ test, error: detail || 'Assertion failed' });
    console.log(`  ❌ ${test}${detail ? ` — ${detail}` : ''}`);
  }
}

async function cleanup() {
  // Delete test data in reverse dependency order
  console.log('\n🧹 Cleaning up test data...');
  try {
    await db.journalLine.deleteMany({ where: { journalEntry: { description: { contains: '[QA TEST]' } } } });
    await db.journalEntry.deleteMany({ where: { description: { contains: '[QA TEST]' } } });
    await db.transaction.deleteMany({ where: { description: { contains: '[QA TEST]' } } });
    await db.pOSInvoicePayment.deleteMany({ where: { invoice: { notes: { contains: '[QA TEST]' } } } });
    await db.pOSInvoiceItem.deleteMany({ where: { invoice: { notes: { contains: '[QA TEST]' } } } });
    await db.pOSInvoice.deleteMany({ where: { notes: { contains: '[QA TEST]' } } });
    await db.stockTransaction.deleteMany({ where: { notes: { contains: '[QA TEST]' } } });
    console.log('  Cleanup done.');
  } catch (e: any) {
    console.log(`  Cleanup error: ${e.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  COMPREHENSIVE QA TEST — Accounting/POS System');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ═══ SECTION 1: DATABASE & SCHEMA ═══
  console.log('📦 Section 1: Database & Schema');
  
  const accountCount = await db.account.count();
  assert(accountCount > 0, 'Accounts exist in DB', `${accountCount} accounts`);
  
  const userCount = await db.user.count();
  assert(userCount > 0, 'Users exist in DB', `${userCount} users`);
  
  const customerCount = await db.customer.count();
  assert(customerCount >= 0, 'Customers table accessible', `${customerCount} customers`);

  const supplierCount = await db.supplier.count();
  assert(supplierCount >= 0, 'Suppliers table accessible', `${supplierCount} suppliers`);

  const productCount = await db.product.count();
  assert(productCount >= 0, 'Products table accessible', `${productCount} products`);

  // ═══ SECTION 2: ACCOUNTING ENGINE — SALE CASH ═══
  console.log('\n💰 Section 2: Accounting Engine — Cash Sale');
  
  const cashAccount = await db.account.findFirst({ where: { code: '1000' } });
  const salesAccountCT = await db.account.findFirst({ where: { code: '4100' } });
  const outputTaxAccount = await db.account.findFirst({ where: { code: '2100' } });
  const discountAllowedAccount = await db.account.findFirst({ where: { code: '5800' } });
  
  assert(!!cashAccount, 'Cash account (1000) exists');
  assert(!!salesAccountCT, 'China Town Sales account (4100) exists');
  assert(!!outputTaxAccount, 'Output Tax account (2100) exists');
  assert(!!discountAllowedAccount, 'Discount Allowed account (5800) exists');

  // Test: Create a cash sale transaction
  const saleAmount = 100;
  const saleTax = round2(saleAmount * 0.15); // 15
  const saleDiscount = 10;
  const saleNet = round2(saleAmount + saleTax - saleDiscount); // 105

  try {
    const saleEntry = await createTransaction({
      type: 'SALE_CASH' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Cash Sale — 100 SAR + 15% VAT - 10 discount',
      amount: saleAmount,
      branch: 'CHINA_TOWN' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      applyTax: true,
      taxAmount: saleTax,
      discountAmount: saleDiscount,
      invoiceNumber: 'QA-TEST-001',
      status: 'POSTED',
    });
    
    assert(!!saleEntry, 'Cash sale transaction created');
    assert(saleEntry.status === 'POSTED', 'Sale entry is POSTED');
    
    // Verify journal lines balance
    const totalDebit = saleEntry.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const totalCredit = saleEntry.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(totalDebit - totalCredit) < 0.01, 'Debit = Credit for sale entry', `Dr=${totalDebit}, Cr=${totalCredit}`);
    
    // Verify specific accounts
    const cashLine = saleEntry.lines.find(l => l.accountId === cashAccount!.id);
    assert(!!cashLine, 'Cash account debited in sale');
    if (cashLine) {
      assert(round2(toNumber(cashLine.debit)) === saleNet, `Cash debited = ${saleNet}`, `Actual: ${cashLine.debit}`);
    }
    
    const salesLine = saleEntry.lines.find(l => l.accountId === salesAccountCT!.id);
    assert(!!salesLine, 'Sales account credited in sale');
    if (salesLine) {
      assert(round2(toNumber(salesLine.credit)) === saleAmount, `Sales credited = ${saleAmount}`, `Actual: ${salesLine.credit}`);
    }
    
    const taxLine = saleEntry.lines.find(l => l.accountId === outputTaxAccount!.id);
    assert(!!taxLine, 'Output tax credited in sale');
    if (taxLine) {
      assert(round2(toNumber(taxLine.credit)) === saleTax, `Tax credited = ${saleTax}`, `Actual: ${taxLine.credit}`);
    }
    
  } catch (e: any) {
    assert(false, 'Cash sale transaction', e.message);
  }

  // ═══ SECTION 3: ACCOUNTING ENGINE — SALE BANK ═══
  console.log('\n💳 Section 3: Accounting Engine — Bank Sale (MADA)');
  
  const bankAccount = await db.account.findFirst({ where: { code: '1010' } });
  assert(!!bankAccount, 'Bank account (1010) exists');

  try {
    const bankSale = await createTransaction({
      type: 'SALE_BANK' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Bank Sale (MADA)',
      amount: 200,
      branch: 'CHINA_TOWN' as Branch,
      paymentMethod: 'MADA' as PaymentMethod,
      applyTax: true,
      taxAmount: 30,
      discountAmount: 0,
      invoiceNumber: 'QA-TEST-002',
      status: 'POSTED',
    });
    
    assert(!!bankSale, 'Bank sale transaction created');
    
    const totalDebit = bankSale.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const totalCredit = bankSale.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(totalDebit - totalCredit) < 0.01, 'Debit = Credit for bank sale', `Dr=${totalDebit}, Cr=${totalCredit}`);
    
    const bankLine = bankSale.lines.find(l => l.accountId === bankAccount!.id);
    assert(!!bankLine, 'Bank account debited in bank sale');
    if (bankLine) {
      assert(round2(toNumber(bankLine.debit)) === 230, 'Bank debited = 230', `Actual: ${bankLine.debit}`);
    }
    
  } catch (e: any) {
    assert(false, 'Bank sale transaction', e.message);
  }

  // ═══ SECTION 4: ACCOUNTING ENGINE — SALE RETURN ═══
  console.log('\n↩️ Section 4: Accounting Engine — Sale Return');
  
  try {
    const returnEntry = await createTransaction({
      type: 'SALE_RETURN_CASH' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Cash Sale Return',
      amount: 50,
      branch: 'CHINA_TOWN' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      applyTax: true,
      taxAmount: 7.5,
      discountAmount: 0,
      invoiceNumber: 'QA-TEST-003',
      status: 'POSTED',
    });
    
    assert(!!returnEntry, 'Return transaction created');
    
    const totalDebit = returnEntry.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const totalCredit = returnEntry.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(totalDebit - totalCredit) < 0.01, 'Debit = Credit for return', `Dr=${totalDebit}, Cr=${totalCredit}`);
    
    // In a return, sales is DEBITED (reduced), cash is CREDITED (refunded)
    const salesLine = returnEntry.lines.find(l => l.accountId === salesAccountCT!.id);
    assert(!!salesLine && salesLine.debit > 0, 'Sales debited (reduced) in return');
    
    const cashLine = returnEntry.lines.find(l => l.accountId === cashAccount!.id);
    assert(!!cashLine && cashLine.credit > 0, 'Cash credited (refunded) in return');
    
  } catch (e: any) {
    assert(false, 'Sale return transaction', e.message);
  }

  // ═══ SECTION 5: ACCOUNTING ENGINE — EXPENSE ═══
  console.log('\n💸 Section 5: Accounting Engine — Expense');
  
  const rentAccount = await db.account.findFirst({ where: { code: '5900' } });
  assert(!!rentAccount, 'Rent expense account (5900) exists');

  try {
    const expense = await createTransaction({
      type: 'EXPENSE_CASH' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Rent Payment',
      amount: 5000,
      branch: 'NONE' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      applyTax: false,
      targetAccountId: rentAccount!.id,
      status: 'POSTED',
    });
    
    assert(!!expense, 'Expense transaction created');
    
    const totalDebit = expense.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const totalCredit = expense.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(totalDebit - totalCredit) < 0.01, 'Debit = Credit for expense', `Dr=${totalDebit}, Cr=${totalCredit}`);
    
  } catch (e: any) {
    assert(false, 'Expense transaction', e.message);
  }

  // ═══ SECTION 6: ACCOUNTING ENGINE — COLLECTION & PAYMENT ═══
  console.log('\n🔄 Section 6: Accounting Engine — Collection & Payment');
  
  const customersAccount = await db.account.findFirst({ where: { code: '1100' } });
  const suppliersAccount = await db.account.findFirst({ where: { code: '2000' } });

  try {
    // Collection (تحصيل)
    const collection = await createTransaction({
      type: 'COLLECTION' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Collection from customer',
      amount: 1000,
      branch: 'NONE' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      counterParty: 'Test Customer',
      status: 'POSTED',
    });
    assert(!!collection, 'Collection transaction created');
    
    const collDebit = collection.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const collCredit = collection.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(collDebit - collCredit) < 0.01, 'Debit = Credit for collection', `Dr=${collDebit}, Cr=${collCredit}`);
    
    // Payment (سداد)
    const payment = await createTransaction({
      type: 'PAYMENT' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Payment to supplier',
      amount: 2000,
      branch: 'NONE' as Branch,
      paymentMethod: 'BANK' as PaymentMethod,
      counterParty: 'Test Supplier',
      status: 'POSTED',
    });
    assert(!!payment, 'Payment transaction created');
    
    const payDebit = payment.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const payCredit = payment.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(payDebit - payCredit) < 0.01, 'Debit = Credit for payment', `Dr=${payDebit}, Cr=${payCredit}`);
    
  } catch (e: any) {
    assert(false, 'Collection/Payment transaction', e.message);
  }

  // ═══ SECTION 7: ACCOUNTING ENGINE — DEPOSIT & WITHDRAWAL ═══
  console.log('\n🏦 Section 7: Accounting Engine — Deposit & Withdrawal');
  
  const withdrawalAccount = await db.account.findFirst({ where: { code: '3001' } });

  try {
    const deposit = await createTransaction({
      type: 'DEPOSIT' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Deposit to bank',
      amount: 3000,
      branch: 'NONE' as Branch,
      fromAccountId: cashAccount!.id,
      toAccountId: bankAccount!.id,
      status: 'POSTED',
    });
    assert(!!deposit, 'Deposit transaction created');
    
    const depDebit = deposit.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const depCredit = deposit.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(depDebit - depCredit) < 0.01, 'Debit = Credit for deposit', `Dr=${depDebit}, Cr=${depCredit}`);
    
    const withdrawal = await createTransaction({
      type: 'WITHDRAWAL' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Owner withdrawal',
      amount: 1000,
      branch: 'NONE' as Branch,
      fromAccountId: cashAccount!.id,
      status: 'POSTED',
    });
    assert(!!withdrawal, 'Withdrawal transaction created');
    
    const wdDebit = withdrawal.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const wdCredit = withdrawal.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(wdDebit - wdCredit) < 0.01, 'Debit = Credit for withdrawal', `Dr=${wdDebit}, Cr=${wdCredit}`);
    
  } catch (e: any) {
    assert(false, 'Deposit/Withdrawal transaction', e.message);
  }

  // ═══ SECTION 8: ACCOUNTING ENGINE — TRANSFER ═══
  console.log('\n🔀 Section 8: Accounting Engine — Transfer');
  
  try {
    const transfer = await createTransaction({
      type: 'TRANSFER' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Transfer cash to bank',
      amount: 500,
      branch: 'NONE' as Branch,
      fromAccountId: cashAccount!.id,
      toAccountId: bankAccount!.id,
      status: 'POSTED',
    });
    assert(!!transfer, 'Transfer transaction created');
    
    const trDebit = transfer.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
    const trCredit = transfer.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
    assert(Math.abs(trDebit - trCredit) < 0.01, 'Debit = Credit for transfer', `Dr=${trDebit}, Cr=${trCredit}`);
    
  } catch (e: any) {
    assert(false, 'Transfer transaction', e.message);
  }

  // ═══ SECTION 9: VALIDATION TESTS ═══
  console.log('\n🛡️ Section 9: Validation Tests');
  
  // Test: Empty manual entry should fail
  try {
    await createTransaction({
      type: 'MANUAL' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Empty manual entry',
      amount: 0,
      lines: [],
      status: 'DRAFT',
    });
    assert(false, 'Empty manual entry should be rejected');
  } catch (e: any) {
    assert(e.message.includes('بند واحد'), 'Empty manual entry rejected with correct error', e.message.substring(0, 60));
  }

  // Test: Negative debit should fail
  try {
    await createTransaction({
      type: 'MANUAL' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Negative debit',
      amount: 0,
      lines: [
        { accountId: cashAccount!.id, debit: -100, credit: 0 },
        { accountId: salesAccountCT!.id, debit: 0, credit: -100 },
      ],
      status: 'DRAFT',
    });
    assert(false, 'Negative debit/credit should be rejected');
  } catch (e: any) {
    assert(e.message.includes('سالبة') || e.message.includes('نفس الوقت'), 'Negative values rejected', e.message.substring(0, 60));
  }

  // Test: Discount > amount should fail
  try {
    await createTransaction({
      type: 'SALE_CASH' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Discount > amount',
      amount: 50,
      branch: 'CHINA_TOWN' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      applyTax: false,
      discountAmount: 100,
      status: 'POSTED',
    });
    assert(false, 'Discount > amount should be rejected');
  } catch (e: any) {
    assert(e.message.includes('الخصم') || e.message.includes('أكبر'), 'Discount > amount rejected', e.message.substring(0, 60));
  }

  // Test: Both debit and credit on same line should fail
  try {
    await createTransaction({
      type: 'MANUAL' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Both debit and credit',
      amount: 0,
      lines: [
        { accountId: cashAccount!.id, debit: 100, credit: 100 },
      ],
      status: 'DRAFT',
    });
    assert(false, 'Both debit and credit on same line should be rejected');
  } catch (e: any) {
    assert(e.message.includes('نفس الوقت') || e.message.includes('مديناً ودائناً'), 'Both debit/credit rejected', e.message.substring(0, 60));
  }

  // Test: Zero amount for non-MANUAL type should fail
  try {
    await createTransaction({
      type: 'SALE_CASH' as JournalEntryType,
      date: new Date(),
      description: '[QA TEST] Zero amount sale',
      amount: 0,
      branch: 'CHINA_TOWN' as Branch,
      paymentMethod: 'CASH' as PaymentMethod,
      applyTax: false,
      status: 'POSTED',
    });
    assert(false, 'Zero amount sale should be rejected');
  } catch (e: any) {
    assert(e.message.includes('أكبر من صفر'), 'Zero amount rejected', e.message.substring(0, 60));
  }

  // ═══ SECTION 10: ZATCA QR ═══
  console.log('\n📱 Section 10: ZATCA QR Code');
  
  try {
    const qr = generateZatcaQR({
      sellerName: 'مطاعم الأصيل',
      vatNumber: '310000000000003',
      timestamp: new Date().toISOString(),
      totalAmount: '115.00',
      vatAmount: '15.00',
    });
    assert(qr.length > 0, 'ZATCA QR generated', `${qr.length} chars`);
    assert(qr !== '', 'QR is not empty');
  } catch (e: any) {
    assert(false, 'ZATCA QR generation', e.message);
  }

  // Test: QR with very long seller name should fail
  try {
    const longName = 'م'.repeat(200); // 200 Arabic chars = ~400 UTF-8 bytes
    generateZatcaQR({
      sellerName: longName,
      vatNumber: '310000000000003',
      timestamp: new Date().toISOString(),
      totalAmount: '100.00',
      vatAmount: '15.00',
    });
    assert(false, 'Long seller name should be rejected (>255 bytes)');
  } catch (e: any) {
    assert(e.message.includes('255'), 'Long seller name rejected with length error', e.message.substring(0, 60));
  }

  // ═══ SECTION 11: NUMBER GENERATION ═══
  console.log('\n🔢 Section 11: Number Generation');
  
  try {
    const entryNum = await generateEntryNumber();
    assert(entryNum.startsWith('JE-'), 'Entry number starts with JE-', entryNum);
    
    const txnNum = await generateTransactionNumber();
    assert(txnNum.startsWith('TXN-'), 'Transaction number starts with TXN-', txnNum);
  } catch (e: any) {
    assert(false, 'Number generation', e.message);
  }

  // ═══ SECTION 12: BALANCE RECALCULATION ═══
  console.log('\n⚖️ Section 12: Balance Recalculation');
  
  try {
    await recalculateAllBalances();
    
    // Verify all accounts have correct balances by checking trial balance
    const accounts = await db.account.findMany({
      where: { type: { in: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] } },
      select: { id: true, code: true, name: true, type: true, currentBalance: true },
    });
    
    // Calculate total debits and credits from journal lines
    const postedSums = await db.journalLine.groupBy({
      by: ['accountId'],
      where: { journalEntry: { status: 'POSTED' } },
      _sum: { debit: true, credit: true },
    });
    
    let totalDebits = 0;
    let totalCredits = 0;
    const NORMAL_BALANCE: Record<string, 'DEBIT' | 'CREDIT'> = {
      ASSET: 'DEBIT', LIABILITY: 'CREDIT', EQUITY: 'CREDIT',
      REVENUE: 'CREDIT', EXPENSE: 'DEBIT',
    };
    
    for (const sum of postedSums) {
      totalDebits += toNumber(sum._sum.debit);
      totalCredits += toNumber(sum._sum.credit);
    }
    
    assert(Math.abs(totalDebits - totalCredits) < 0.01, 'Total Debits = Total Credits across ALL posted entries', `Dr=${totalDebits.toFixed(2)}, Cr=${totalCredits.toFixed(2)}, Diff=${Math.abs(totalDebits-totalCredits).toFixed(4)}`);
    
  } catch (e: any) {
    assert(false, 'Balance recalculation', e.message);
  }

  // ═══ SECTION 13: YEAR END CLOSING ═══
  console.log('\n📅 Section 13: Year End Closing');
  
  try {
    // Test that YEAR_END_CLOSING type works (previously crashed)
    const revenueAccounts = await db.account.findMany({
      where: { type: 'REVENUE', currentBalance: { not: 0 } },
      select: { id: true, code: true, currentBalance: true },
    });
    
    const expenseAccounts = await db.account.findMany({
      where: { type: 'EXPENSE', currentBalance: { not: 0 } },
      select: { id: true, code: true, currentBalance: true },
    });
    
    if (revenueAccounts.length > 0 || expenseAccounts.length > 0) {
      // Build closing entry lines
      const lines: { accountId: string; debit: number; credit: number }[] = [];
      
      // Close revenue accounts (debit to zero out credit balances)
      for (const acc of revenueAccounts) {
        lines.push({ accountId: acc.id, debit: Math.abs(toNumber(acc.currentBalance)), credit: 0 });
      }
      
      // Close expense accounts (credit to zero out debit balances)
      for (const acc of expenseAccounts) {
        lines.push({ accountId: acc.id, debit: 0, credit: Math.abs(toNumber(acc.currentBalance)) });
      }
      
      // Balance with retained earnings
      const totalRevenue = revenueAccounts.reduce((s, a) => s + Math.abs(Number(a.currentBalance)), 0);
      const totalExpenses = expenseAccounts.reduce((s, a) => s + Math.abs(Number(a.currentBalance)), 0);
      const netIncome = totalRevenue - totalExpenses;
      
      const retainedEarnings = await db.account.findFirst({ where: { code: '3100' } });
      if (retainedEarnings) {
        if (netIncome > 0) {
          lines.push({ accountId: retainedEarnings.id, debit: 0, credit: netIncome });
        } else if (netIncome < 0) {
          lines.push({ accountId: retainedEarnings.id, debit: Math.abs(netIncome), credit: 0 });
        }
      }
      
      if (lines.length > 0) {
        const closingEntry = await createTransaction({
          type: 'YEAR_END_CLOSING' as JournalEntryType,
          date: new Date(),
          description: '[QA TEST] Year End Closing Entry',
          amount: 0,
          lines,
          status: 'POSTED',
        });
        assert(!!closingEntry, 'Year End Closing entry created (was crashing before fix)');
        
        const closingDebit = closingEntry.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
        const closingCredit = closingEntry.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
        assert(Math.abs(closingDebit - closingCredit) < 0.01, 'Closing entry balanced', `Dr=${closingDebit}, Cr=${closingCredit}`);
      } else {
        console.log('  ⏭️ No revenue/expense balances to close — skipped');
      }
    } else {
      console.log('  ⏭️ No revenue/expense balances to close — skipped');
    }
  } catch (e: any) {
    assert(false, 'Year End Closing', e.message);
  }

  // ═══ SECTION 14: CONCURRENT INVOICE NUMBER GENERATION ═══
  console.log('\n⚡ Section 14: Concurrent Number Generation');
  
  try {
    // Generate 10 entry numbers concurrently
    const promises = Array.from({ length: 10 }, () => generateEntryNumber());
    const numbers = await Promise.all(promises);
    const uniqueNumbers = new Set(numbers);
    assert(uniqueNumbers.size === 10, '10 concurrent entry numbers are unique', `${uniqueNumbers.size}/10 unique`);
  } catch (e: any) {
    assert(false, 'Concurrent number generation', e.message);
  }

  // ═══ SECTION 15: BACKUP & RESTORE ═══
  console.log('\n💾 Section 15: Backup & Restore (Data Integrity)');
  
  try {
    // Count records before backup
    const beforeCount = {
      accounts: await db.account.count(),
      journalEntries: await db.journalEntry.count(),
      journalLines: await db.journalLine.count(),
      transactions: await db.transaction.count(),
      users: await db.user.count(),
    };
    
    assert(beforeCount.accounts > 0, 'Accounts exist for backup', `${beforeCount.accounts} accounts`);
    assert(beforeCount.journalEntries > 0, 'Journal entries exist for backup', `${beforeCount.journalEntries} entries`);
    assert(beforeCount.transactions > 0, 'Transactions exist for backup', `${beforeCount.transactions} transactions`);
    
    console.log(`  Pre-backup counts: ${JSON.stringify(beforeCount)}`);
    
    // The actual backup/restore API is tested through HTTP, but we verify data counts are consistent
    const allEntries = await db.journalEntry.findMany({
      where: { status: 'POSTED' },
      include: { lines: true },
    });
    
    let allBalanced = true;
    for (const entry of allEntries) {
      const dr = entry.lines.reduce((s, l) => round2(s + toNumber(l.debit)), 0);
      const cr = entry.lines.reduce((s, l) => round2(s + toNumber(l.credit)), 0);
      if (Math.abs(dr - cr) >= 0.01) {
        allBalanced = false;
        console.log(`  ❌ Unbalanced entry: ${entry.entryNumber} — Dr=${dr}, Cr=${cr}`);
      }
    }
    assert(allBalanced, 'All posted journal entries are balanced');
    
  } catch (e: any) {
    assert(false, 'Backup data integrity', e.message);
  }

  // ═══ CLEANUP ═══
  await cleanup();

  // ═══ FINAL RESULTS ═══
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ Passed: ${testsPassed}`);
  console.log(`  ❌ Failed: ${testsFailed}`);
  console.log(`  📊 Total:  ${testsPassed + testsFailed}`);
  console.log(`  📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
  
  if (errors.length > 0) {
    console.log('\n  ❌ Failed Tests:');
    for (const err of errors) {
      console.log(`    - ${err.test}: ${err.error}`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  
  await db.$disconnect();
  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await db.$disconnect();
  process.exit(1);
});
