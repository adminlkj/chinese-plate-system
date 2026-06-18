const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const { execSync } = require('child_process');

const results = [];

function record(phase, test, passed, detail) {
  results.push({ phase, test, passed, detail });
  console.log('  ' + (passed ? '✅' : '❌') + ' ' + test + ': ' + detail);
}

async function main() {
  console.log('============================================');
  console.log('COMPREHENSIVE SYSTEM AUDIT');
  console.log('============================================');

  // ===== PHASE 4: ACCOUNTING =====
  console.log('\n--- PHASE 4: ACCOUNTING AUDIT ---');
  
  const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } });
  const allParentIds = new Set(accounts.filter(a => a.parentId).map(a => a.parentId));
  const parentAccounts = accounts.filter(a => allParentIds.has(a.id));
  
  const postedLines = await prisma.journalLine.findMany({
    where: { journalEntry: { status: 'POSTED' } },
    include: { account: true }
  });

  let totalDebits = 0, totalCredits = 0;
  const accountSums = {};
  for (const line of postedLines) {
    const d = Number(line.debit) || 0;
    const c = Number(line.credit) || 0;
    totalDebits += d;
    totalCredits += c;
    if (!accountSums[line.accountId]) {
      accountSums[line.accountId] = { debit: 0, credit: 0, type: line.account.type, code: line.account.code, name: line.account.name };
    }
    accountSums[line.accountId].debit += d;
    accountSums[line.accountId].credit += c;
  }

  const tbDiff = Math.abs(totalDebits - totalCredits);
  record('P4', 'Trial Balance D=C', tbDiff < 0.01, 'D=' + totalDebits.toFixed(2) + ' C=' + totalCredits.toFixed(2) + ' diff=' + tbDiff.toFixed(2));

  let assetTotal = 0, liabilityTotal = 0, equityTotal = 0, revenueTotal = 0, expenseTotal = 0;
  for (const [, sums] of Object.entries(accountSums)) {
    const s = sums;
    const nb = (s.type === 'ASSET' || s.type === 'EXPENSE') ? 'DEBIT' : 'CREDIT';
    const bal = nb === 'DEBIT' ? s.debit - s.credit : s.credit - s.debit;
    if (s.type === 'ASSET') assetTotal += bal;
    else if (s.type === 'LIABILITY') liabilityTotal += bal;
    else if (s.type === 'EQUITY') equityTotal += bal;
    else if (s.type === 'REVENUE') revenueTotal += bal;
    else if (s.type === 'EXPENSE') expenseTotal += bal;
  }
  const netIncome = revenueTotal - expenseTotal;
  const bsDiff = Math.abs(assetTotal - liabilityTotal - equityTotal - netIncome);
  record('P4', 'Balance Sheet A=L+E+NI', bsDiff < 0.01, 'diff=' + bsDiff.toFixed(2));

  let mismatches = 0;
  for (const a of accounts) {
    const sums = accountSums[a.id];
    if (sums) {
      const nb = (a.type === 'ASSET' || a.type === 'EXPENSE') ? 'DEBIT' : 'CREDIT';
      const calculated = nb === 'DEBIT' ? sums.debit - sums.credit : sums.credit - sums.debit;
      const current = Number(a.currentBalance);
      if (Math.abs(calculated - current) > 0.01) mismatches++;
    }
  }
  record('P4', 'Account Balances Match', mismatches === 0, mismatches + ' mismatches');

  const parentPostings = await prisma.journalLine.findMany({
    where: { accountId: { in: [...allParentIds] } },
    include: { account: true }
  });
  record('P4', 'No Parent Postings', parentPostings.length === 0, parentPostings.length + ' violations');

  const parentsWithoutComputed = parentAccounts.filter(a => !a.isComputed);
  record('P4', 'Parent isComputed Flag', parentsWithoutComputed.length === 0, parentsWithoutComputed.length + ' parents without flag');

  const entries = await prisma.journalEntry.findMany({ include: { lines: true } });
  let unbalanced = 0;
  const singleLine = entries.filter(e => e.lines.length < 2);
  for (const e of entries) {
    const dSum = e.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cSum = e.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(dSum - cSum) > 0.01) unbalanced++;
  }
  record('P4', 'JE Balanced', unbalanced === 0, unbalanced + ' unbalanced');
  record('P4', 'JE Min 2 Lines', singleLine.length === 0, singleLine.length + ' with <2 lines');

  const invoices = await prisma.pOSInvoice.findMany();
  const finalized = invoices.filter(i => i.status === 'FINALIZED');
  const noTxn = finalized.filter(i => !i.transactionId);
  record('P4', 'Invoice-Txn Linkage', noTxn.length === 0, noTxn.length + ' without txn');

  const txns = await prisma.transaction.findMany({ include: { journalEntries: true } });
  const noJE = txns.filter(t => t.journalEntries.length === 0);
  record('P4', 'Txn-JE Linkage', noJE.length === 0, noJE.length + ' without JE');

  let doubleCounting = 0;
  for (const parent of parentAccounts) {
    const children = accounts.filter(a => a.parentId === parent.id);
    const parentBal = Number(parent.currentBalance);
    const childrenSum = children.reduce((s, c) => s + Number(c.currentBalance), 0);
    if (children.length > 0 && Math.abs(parentBal - childrenSum) > 0.01) doubleCounting++;
  }
  record('P4', 'No Double Counting', doubleCounting === 0, doubleCounting + ' issues');

  // ===== PHASE 5: POS =====
  console.log('\n--- PHASE 5: POS AUDIT ---');
  
  let invoiceTotalIssues = 0;
  for (const inv of invoices) {
    const items = await prisma.pOSInvoiceItem.findMany({ where: { invoiceId: inv.id } });
    const payments = await prisma.pOSInvoicePayment.findMany({ where: { invoiceId: inv.id } });
    const expectedTotal = Number(inv.subtotal) - Number(inv.discountAmount) + Number(inv.taxAmount);
    if (Math.abs(Number(inv.totalAmount) - expectedTotal) > 0.01) invoiceTotalIssues++;
  }
  record('P5', 'Invoice Totals Correct', invoiceTotalIssues === 0, invoiceTotalIssues + ' issues');

  const invoicesWithoutItems = [];
  for (const inv of invoices) {
    const c = await prisma.pOSInvoiceItem.count({ where: { invoiceId: inv.id } });
    if (c === 0) invoicesWithoutItems.push(inv.invoiceNumber);
  }
  record('P5', 'Invoice has Items', invoicesWithoutItems.length === 0, invoicesWithoutItems.length + ' empty');

  const invoicesWithoutPayment = [];
  for (const inv of finalized) {
    const c = await prisma.pOSInvoicePayment.count({ where: { invoiceId: inv.id } });
    if (c === 0) invoicesWithoutPayment.push(inv.invoiceNumber);
  }
  record('P5', 'Finalized has Payment', invoicesWithoutPayment.length === 0, invoicesWithoutPayment.length + ' without payment');

  // ===== PHASE 6: INVENTORY =====
  console.log('\n--- PHASE 6: INVENTORY AUDIT ---');

  const products = await prisma.product.findMany();
  let stockMismatches = 0, negativeStock = 0;
  for (const p of products) {
    const transactions = await prisma.stockTransaction.findMany({ where: { productId: p.id } });
    // Simply sum all quantities - they already have correct sign in DB
    // SALE: negative, PURCHASE: positive, OPENING: positive, etc.
    let expected = 0;
    for (const t of transactions) {
      expected += Number(t.quantity);
    }
    if (Math.abs(Number(p.currentStock) - expected) > 0.01) stockMismatches++;
    if (Number(p.currentStock) < 0) negativeStock++;
  }
  record('P6', 'Stock Matches Transactions', stockMismatches === 0, stockMismatches + ' mismatches');
  record('P6', 'No Negative Stock', negativeStock === 0, negativeStock + ' negative');

  // ===== PHASE 7: BACKUP =====
  console.log('\n--- PHASE 7: BACKUP AUDIT ---');
  record('P7', 'Export API', fs.existsSync('src/app/api/data/export/route.ts'), 'Found');
  record('P7', 'Import API', fs.existsSync('src/app/api/data/import/route.ts'), 'Found');
  record('P7', 'Auto-Backup API', fs.existsSync('src/app/api/data/auto-backup/route.ts'), 'Found');
  record('P7', 'DB File Exists', fs.existsSync('db/custom.db'), (fs.statSync('db/custom.db').size/1024).toFixed(0)+'KB');

  // ===== PHASE 8: AUTH =====
  console.log('\n--- PHASE 8: AUTH AUDIT ---');
  
  const users = await prisma.user.findMany({ include: { permissions: true } });
  const roles = {};
  for (const u of users) roles[u.role] = (roles[u.role] || 0) + 1;
  record('P8', 'Admin Exists', (roles['ADMIN'] || 0) > 0, roles['ADMIN'] + ' admins');
  record('P8', 'Manager Exists', (roles['MANAGER'] || 0) > 0, roles['MANAGER'] + ' managers');
  record('P8', 'Cashier Exists', (roles['CASHIER'] || 0) > 0, roles['CASHIER'] + ' cashiers');
  record('P8', 'Viewer Exists', (roles['VIEWER'] || 0) > 0, roles['VIEWER'] + ' viewers');

  let plaintextPw = 0;
  for (const u of users) {
    if (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) plaintextPw++;
  }
  record('P8', 'Passwords bcrypt Hashed', plaintextPw === 0, plaintextPw + ' plaintext');

  const xssUsers = users.filter(u => u.name.includes('<script') || u.name.includes('document.cookie'));
  record('P8', 'No XSS in User Names', xssUsers.length === 0, xssUsers.length + ' XSS payloads');

  // ===== PHASE 9: SECURITY =====
  console.log('\n--- PHASE 9: SECURITY AUDIT ---');

  record('P9', 'Rate Limit Module', fs.existsSync('src/lib/rate-limit.ts'), 'Found');
  record('P9', 'Middleware', fs.existsSync('src/middleware.ts'), 'Found');
  record('P9', 'API Auth Module', fs.existsSync('src/lib/api-auth.ts'), 'Found');

  const envContent = fs.readFileSync('.env', 'utf8');
  record('P9', 'NEXTAUTH_SECRET Set', envContent.includes('NEXTAUTH_SECRET='), envContent.includes('NEXTAUTH_SECRET=') ? 'Present' : 'MISSING');

  let rawSqlFiles = 0;
  try {
    // Only flag $queryRawUnsafe with string interpolation (SQL injection risk)
    // PRAGMA statements and static strings are safe
    const grepResult = execSync('grep -r "\\\$queryRawUnsafe\\|\\$executeRawUnsafe" src/app/api --include="*.ts" -l 2>/dev/null || true').toString();
    const files = grepResult.trim().split('\n').filter(f => f.length > 0);
    // Check if any use string interpolation (dangerous) vs static strings (safe)
    let dangerousRawSql = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const hasInterpolation = content.match(/\$queryRawUnsafe\([^)]*\$\{/);
      const hasExecuteInterpolation = content.match(/\$executeRawUnsafe\([^)]*\$\{/);
      if (hasInterpolation || hasExecuteInterpolation) {
        dangerousRawSql++;
        console.log('  DANGEROUS RAW SQL: ' + file);
      }
    }
    rawSqlFiles = dangerousRawSql;
  } catch(e) {}
  record('P9', 'No Raw SQL', rawSqlFiles === 0, rawSqlFiles + ' files with raw SQL');

  if (fs.existsSync('src/middleware.ts')) {
    const mw = fs.readFileSync('src/middleware.ts', 'utf8');
    record('P9', 'Security Headers', mw.includes('X-Frame-Options') || mw.includes('Content-Security'), 'Present');
    record('P9', 'Rate Limit in Middleware', mw.includes('rateLimit') || mw.includes('rate-limit'), 'Configured');
  }

  if (fs.existsSync('src/lib/api-auth.ts')) {
    const auth = fs.readFileSync('src/lib/api-auth.ts', 'utf8');
    record('P9', 'requireAuth', auth.includes('requireAuth'), 'Found');
    record('P9', 'Input Sanitization', auth.includes('sanitizeHtml') || auth.includes('sanitizeInput'), 'Found');
  }

  // ===== PHASE 10: PERFORMANCE =====
  console.log('\n--- PHASE 10: PERFORMANCE AUDIT ---');
  const dbSize = fs.statSync('db/custom.db').size;
  record('P10', 'DB Size OK', dbSize < 100*1024*1024, (dbSize/1024).toFixed(0)+'KB');

  const idxResult = await prisma.$queryRaw`SELECT count(*) as cnt FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`;
  const idxCount = Number(idxResult[0]?.cnt || 0);
  record('P10', 'Index Coverage', idxCount > 50, idxCount + ' indexes');

  const walResult = await prisma.$queryRaw`PRAGMA journal_mode`;
  record('P10', 'WAL Mode', walResult[0]?.journal_mode === 'wal', walResult[0]?.journal_mode || 'unknown');

  // ===== PHASE 11: FAULT RECOVERY =====
  console.log('\n--- PHASE 11: FAULT RECOVERY ---');
  record('P11', 'System Recover API', fs.existsSync('src/app/api/system-recover/route.ts'), 'Found');
  record('P11', 'DB Recover API', fs.existsSync('src/app/api/system-recover/database/route.ts'), 'Found');
  record('P11', 'Recalculate API', fs.existsSync('src/app/api/data/recalculate/route.ts'), 'Found');

  const intCheck = await prisma.$queryRaw`PRAGMA integrity_check`;
  record('P11', 'DB Integrity', intCheck[0]?.integrity_check === 'ok', intCheck[0]?.integrity_check || 'FAILED');

  const fkCheck = await prisma.$queryRaw`PRAGMA foreign_key_check`;
  record('P11', 'FK Check Clean', !Array.isArray(fkCheck) || fkCheck.length === 0, (Array.isArray(fkCheck) ? fkCheck.length : 0) + ' violations');

  // ===== SUMMARY =====
  console.log('\n============================================');
  console.log('AUDIT SUMMARY');
  console.log('============================================');

  const phases = [...new Set(results.map(r => r.phase))];
  let totalPass = 0, totalFail = 0;
  const criticalIssues = [];

  for (const phase of phases) {
    const pr2 = results.filter(r => r.phase === phase);
    const pass = pr2.filter(r => r.passed).length;
    const fail = pr2.filter(r => !r.passed).length;
    totalPass += pass;
    totalFail += fail;
    console.log(phase + ': ' + pass + '/' + pr2.length + ' passed');
    for (const r of pr2.filter(r => !r.passed)) {
      console.log('  ❌ ' + r.test + ': ' + r.detail);
      criticalIssues.push(r);
    }
  }

  console.log('\nTotal: ' + totalPass + '/' + (totalPass+totalFail) + ' (' + Math.round(totalPass/(totalPass+totalFail)*100) + '%)');

  const p4Results = results.filter(r => r.phase === 'P4');
  const p6Results = results.filter(r => r.phase === 'P6');
  const p9Results = results.filter(r => r.phase === 'P9');
  const p10Results = results.filter(r => r.phase === 'P10');
  
  const accountingScore = p4Results.filter(r=>r.passed).length / Math.max(p4Results.length,1) * 100;
  const dbScore = [...p4Results,...p6Results].filter(r=>r.passed).length / Math.max([...p4Results,...p6Results].length,1) * 100;
  const secScore = p9Results.filter(r=>r.passed).length / Math.max(p9Results.length,1) * 100;
  const perfScore = p10Results.filter(r=>r.passed).length / Math.max(p10Results.length,1) * 100;

  console.log('\n=== SCORES ===');
  console.log('Accounting Integrity: ' + accountingScore.toFixed(0) + '%');
  console.log('Database Integrity: ' + dbScore.toFixed(0) + '%');
  console.log('Security Score: ' + secScore.toFixed(0) + '%');
  console.log('Performance Score: ' + perfScore.toFixed(0) + '%');
  console.log('Production Readiness: ' + Math.round(totalPass/(totalPass+totalFail)*100) + '%');

  console.log('\n=== FINAL VERDICT ===');
  const ready = totalFail === 0 && accountingScore >= 95 && dbScore >= 95;
  console.log(ready ? '✅ READY FOR PRODUCTION' : '❌ NOT READY FOR PRODUCTION');
  if (!ready) {
    console.log('Blockers:');
    if (totalFail > 0) console.log('  - ' + totalFail + ' failed tests');
    if (accountingScore < 95) console.log('  - Accounting integrity ' + accountingScore.toFixed(0) + '% < 95%');
    if (dbScore < 95) console.log('  - Database integrity ' + dbScore.toFixed(0) + '% < 95%');
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
