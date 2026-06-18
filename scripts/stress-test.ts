/**
 * Stress Test Script for the Accounting System
 * Creates large volumes of data to test performance and reliability
 * 
 * Usage: bun run scripts/stress-test.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { performance } from 'perf_hooks';

const prisma = new PrismaClient();

// ─── Configuration ─────────────────────────────────────────────────
const CONFIG = {
  products: 1000,
  customers: 500,
  invoices: 5000,
  journalEntries: 10000,
  branches: ['CHINA_TOWN', 'PALACE_INDIA', 'NONE'] as const,
};

// ─── Helpers ──────────────────────────────────────────────────────
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomAmount(min: number, max: number) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

async function timeIt<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  console.log(`⏱  ${label}: ${elapsed.toFixed(0)}ms`);
  return result;
}

// ─── Seed Functions ───────────────────────────────────────────────

async function seedSettings() {
  console.log('\n📌 Seeding settings...');
  await timeIt('Settings', async () => {
    const settings = [
      { key: 'companyName', value: 'مطعم الطبق الصيني للاختبار' },
      { key: 'companyNameEn', value: 'China Dish Restaurant - Test' },
      { key: 'taxNumber', value: '300000000000003' },
      { key: 'taxRate', value: '15' },
      { key: 'defaultCurrency', value: 'SAR' },
    ];
    for (const s of settings) {
      await prisma.setting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: s,
      });
    }
  });
}

async function seedBranches() {
  console.log('\n📌 Seeding branches...');
  await timeIt('Branches', async () => {
    const branches = [
      { code: 'NONE', name: 'عام', nameEn: 'General', sortOrder: 0 },
      { code: 'CHINA_TOWN', name: 'تشاينا تاون', nameEn: 'China Town', sortOrder: 1 },
      { code: 'PALACE_INDIA', name: 'بالاس إنديا', nameEn: 'Palace India', sortOrder: 2 },
    ];
    for (const b of branches) {
      await prisma.branch.upsert({
        where: { code: b.code },
        update: b,
        create: b,
      });
    }
  });
}

async function seedAdminUser() {
  console.log('\n📌 Seeding admin user...');
  await timeIt('Admin User', async () => {
    const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 12);
      await prisma.user.create({
        data: {
          email: 'stress@test.com',
          name: 'مدير الاختبار',
          nameEn: 'Test Admin',
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true,
          permissions: {
            create: [
              { screen: 'dashboard', accessLevel: 'FULL' },
              { screen: 'pos', accessLevel: 'FULL' },
              { screen: 'chart-of-accounts', accessLevel: 'FULL' },
              { screen: 'transactions', accessLevel: 'FULL' },
              { screen: 'journal', accessLevel: 'FULL' },
              { screen: 'settings', accessLevel: 'FULL' },
              { screen: 'users', accessLevel: 'FULL' },
            ],
          },
        },
      });
    }
  });
}

async function seedAccounts() {
  console.log('\n📌 Seeding chart of accounts...');
  await timeIt('Accounts', async () => {
    const existingCount = await prisma.account.count();
    if (existingCount > 0) {
      console.log(`  Accounts already exist (${existingCount}), skipping...`);
      return;
    }

    const accounts = [
      { code: '1000', name: 'النقدية', nameEn: 'Cash', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
      { code: '1010', name: 'بنك الراجحي', nameEn: 'Al Rajhi Bank', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
      { code: '1100', name: 'العملاء', nameEn: 'Customers', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
      { code: '1200', name: 'ضريبة مدخلات', nameEn: 'Input Tax', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
      { code: '1300', name: 'المخزون', nameEn: 'Inventory', type: 'ASSET', level: 1, isSystem: true, branch: 'NONE' },
      { code: '2000', name: 'الموردون', nameEn: 'Suppliers', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
      { code: '2100', name: 'ضريبة مخرجات', nameEn: 'Output Tax', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
      { code: '2600', name: 'ضريبة مستحقة', nameEn: 'Tax Payable', type: 'LIABILITY', level: 1, isSystem: true, branch: 'NONE' },
      { code: '3000', name: 'رأس المال', nameEn: 'Capital', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },
      { code: '3100', name: 'أرباح محتجزة', nameEn: 'Retained Earnings', type: 'EQUITY', level: 1, isSystem: true, branch: 'NONE' },
      { code: '4000', name: 'المبيعات', nameEn: 'Sales', type: 'REVENUE', level: 1, isSystem: true, branch: 'NONE' },
      { code: '4100', name: 'مبيعات China Town', nameEn: 'China Town Sales', type: 'REVENUE', level: 2, isSystem: true, branch: 'CHINA_TOWN', parentId: undefined },
      { code: '4200', name: 'مبيعات Palace India', nameEn: 'Palace India Sales', type: 'REVENUE', level: 2, isSystem: true, branch: 'PALACE_INDIA', parentId: undefined },
      { code: '5000', name: 'المشتريات', nameEn: 'Purchases', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
      { code: '5001', name: 'مشتريات عامة', nameEn: 'General Purchases', type: 'EXPENSE', level: 2, isSystem: true, branch: 'NONE', parentId: undefined },
      { code: '5950', name: 'تكلفة البضاعة المباعة', nameEn: 'COGS', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
      { code: '5900', name: 'إيجار', nameEn: 'Rent', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
      { code: '6100', name: 'رواتب', nameEn: 'Salaries', type: 'EXPENSE', level: 1, isSystem: true, branch: 'NONE' },
    ];

    const codeToIdMap = new Map<string, string>();

    for (const acc of accounts) {
      const parentDbId = acc.parentId ? codeToIdMap.get(acc.parentId) : null;
      const created = await prisma.account.create({
        data: {
          code: acc.code,
          name: acc.name,
          nameEn: acc.nameEn,
          type: acc.type,
          level: acc.level,
          isSystem: acc.isSystem,
          branch: acc.branch,
          parentId: parentDbId,
          openingBalance: 0,
          currentBalance: 0,
        },
      });
      codeToIdMap.set(acc.code, created.id);
    }
  });
}

async function seedCategories() {
  console.log('\n📌 Seeding product categories...');
  const categoryIds: string[] = [];

  await timeIt(`Categories`, async () => {
    const categories = [
      { name: 'مشويات', nameEn: 'Grills', branch: 'CHINA_TOWN', sortOrder: 0 },
      { name: 'مقبلات', nameEn: 'Appetizers', branch: 'CHINA_TOWN', sortOrder: 1 },
      { name: 'مشروبات', nameEn: 'Drinks', branch: 'CHINA_TOWN', sortOrder: 2 },
      { name: 'حلويات', nameEn: 'Desserts', branch: 'CHINA_TOWN', sortOrder: 3 },
      { name: 'أطباق رئيسية', nameEn: 'Main Dishes', branch: 'PALACE_INDIA', sortOrder: 0 },
      { name: 'سلطات', nameEn: 'Salads', branch: 'PALACE_INDIA', sortOrder: 1 },
      { name: 'أرز', nameEn: 'Rice', branch: 'PALACE_INDIA', sortOrder: 2 },
    ];

    for (const cat of categories) {
      const created = await prisma.productCategory.upsert({
        where: { name_branch: { name: cat.name, branch: cat.branch } },
        update: {},
        create: cat,
      });
      categoryIds.push(created.id);
    }
  });

  return categoryIds;
}

async function seedProducts(categoryIds: string[]) {
  const existingCount = await prisma.product.count();
  if (existingCount >= CONFIG.products) {
    console.log(`\n📌 Products already exist (${existingCount}), skipping...`);
    return existingCount;
  }

  console.log(`\n📌 Seeding ${CONFIG.products} products...`);

  const BATCH_SIZE = 100;
  let created = existingCount;

  await timeIt(`Products (${CONFIG.products})`, async () => {
    for (let i = existingCount; i < CONFIG.products; i += BATCH_SIZE) {
      const batch = [];
      for (let j = 0; j < BATCH_SIZE && (i + j) < CONFIG.products; j++) {
        const idx = i + j;
        const branch = randomChoice(CONFIG.branches);
        const catId = randomChoice(categoryIds);
        batch.push({
          name: `منتج ${idx + 1}`,
          nameEn: `Product ${idx + 1}`,
          sku: `SKU-${String(idx + 1).padStart(5, '0')}`,
          categoryId: catId,
          branch,
          costPrice: randomAmount(5, 50),
          price: randomAmount(15, 150),
          unit: randomChoice(['قطعة', 'كيلو', 'لتر', 'طبق']),
          currentStock: randomAmount(10, 500),
          minStock: 5,
          maxStock: 1000,
          sortOrder: idx,
        });
      }

      try {
        await prisma.product.createMany({ data: batch });
      } catch {
        // Handle unique constraint violations gracefully
      }
      created += batch.length;
      if (created % 1000 === 0) console.log(`  ... ${created}/${CONFIG.products} products`);
    }
  });

  return created;
}

async function seedCustomers() {
  const existingCount = await prisma.customer.count();
  if (existingCount >= CONFIG.customers) {
    console.log(`\n📌 Customers already exist (${existingCount}), skipping...`);
    return existingCount;
  }

  console.log(`\n📌 Seeding ${CONFIG.customers} customers...`);

  const BATCH_SIZE = 500;
  let created = existingCount;

  await timeIt(`Customers (${CONFIG.customers})`, async () => {
    for (let i = existingCount; i < CONFIG.customers; i += BATCH_SIZE) {
      const batch = [];
      for (let j = 0; j < BATCH_SIZE && (i + j) < CONFIG.customers; j++) {
        const idx = i + j;
        batch.push({
          name: `عميل ${idx + 1}`,
          nameEn: `Customer ${idx + 1}`,
          type: randomChoice(['CASH', 'PLATFORM']),
          balance: 0,
        });
      }

      try {
        await prisma.customer.createMany({ data: batch });
      } catch {
        // Skip unique constraint violations
      }
      created += batch.length;
      if (created % 1000 === 0) console.log(`  ... ${created}/${CONFIG.customers} customers`);
    }
  });

  return created;
}

async function seedFiscalPeriod() {
  console.log('\n📌 Seeding fiscal period...');
  await timeIt('Fiscal Period', async () => {
    const year = new Date().getFullYear();
    const existing = await prisma.fiscalPeriod.findFirst({ where: { name: { contains: String(year) } } });
    if (!existing) {
      await prisma.fiscalPeriod.create({
        data: {
          name: `السنة المالية ${year} / FY ${year}`,
          startDate: new Date(year, 0, 1),
          endDate: new Date(year, 11, 31),
          status: 'OPEN',
        },
      });
    }
  });
}

async function seedInvoices() {
  const existingCount = await prisma.pOSInvoice.count();
  if (existingCount >= CONFIG.invoices) {
    console.log(`\n📌 Invoices already exist (${existingCount}), skipping...`);
    return existingCount;
  }

  console.log(`\n📌 Seeding ${CONFIG.invoices} invoices...`);

  // Get required IDs
  const products = await prisma.product.findMany({ select: { id: true, price: true, costPrice: true, branch: true } });
  const customers = await prisma.customer.findMany({ select: { id: true } });
  const cashAccount = await prisma.account.findFirst({ where: { code: '1000' } });
  const salesAccount = await prisma.account.findFirst({ where: { code: '4000' } });
  const taxOutputAccount = await prisma.account.findFirst({ where: { code: '2100' } });
  const cogsAccount = await prisma.account.findFirst({ where: { code: '5950' } });
  const inventoryAccount = await prisma.account.findFirst({ where: { code: '1300' } });

  if (!cashAccount || !salesAccount) {
    console.log('  ⚠️ Required accounts not found, skipping invoices');
    return 0;
  }

  let created = existingCount;
  const BATCH_SIZE = 50; // Smaller batches for invoices (they have related records)

  await timeIt(`Invoices (${CONFIG.invoices})`, async () => {
    for (let i = existingCount; i < CONFIG.invoices; i += BATCH_SIZE) {
      const batchPromises = [];
      for (let j = 0; j < BATCH_SIZE && (i + j) < CONFIG.invoices; j++) {
        const idx = i + j;
        const product = randomChoice(products);
        const branch = product.branch as string || 'NONE';
        const customer = customers.length > 0 ? randomChoice(customers) : null;
        const subtotal = parseFloat(product.price.toString()) * randomInt(1, 5);
        const taxRate = 0.15;
        const taxAmount = +(subtotal * taxRate).toFixed(2);
        const totalAmount = +(subtotal + taxAmount).toFixed(2);
        const paymentMethod = randomChoice(['CASH', 'MADA', 'VISA'] as const);
        const date = new Date(2026, randomInt(0, 4), randomInt(1, 28));

        batchPromises.push(
          prisma.pOSInvoice.create({
            data: {
              invoiceNumber: `POS-${String(idx + 1).padStart(6, '0')}`,
              branch,
              status: 'FINALIZED',
              customerId: customer?.id || undefined,
              subtotal,
              taxAmount,
              totalAmount,
              paidAmount: totalAmount,
              changeAmount: 0,
              paymentMethod,
              items: {
                create: [{
                  productId: product.id,
                  name: `منتج ${idx + 1}`,
                  quantity: randomInt(1, 5),
                  unitPrice: parseFloat(product.price.toString()),
                  totalPrice: subtotal,
                  sortOrder: 0,
                }],
              },
              payments: {
                create: [{
                  method: paymentMethod,
                  amount: totalAmount,
                }],
              },
            },
          })
        );
      }

      await Promise.all(batchPromises);
      created += batchPromises.length;
      if (created % 1000 === 0) console.log(`  ... ${created}/${CONFIG.invoices} invoices`);
    }
  });

  return created;
}

async function seedJournalEntries() {
  const existingCount = await prisma.journalEntry.count();
  if (existingCount >= CONFIG.journalEntries) {
    console.log(`\n📌 Journal entries already exist (${existingCount}), skipping...`);
    return existingCount;
  }

  console.log(`\n📌 Seeding ${CONFIG.journalEntries} journal entries...`);

  const accounts = await prisma.account.findMany({ select: { id: true, code: true, type: true } });
  const period = await prisma.fiscalPeriod.findFirst({ where: { status: 'OPEN' } });

  if (accounts.length < 2 || !period) {
    console.log('  ⚠️ Required data not found, skipping journal entries');
    return 0;
  }

  let created = existingCount;
  const BATCH_SIZE = 100;

  await timeIt(`Journal Entries (${CONFIG.journalEntries})`, async () => {
    for (let i = existingCount; i < CONFIG.journalEntries; i += BATCH_SIZE) {
      const batch = [];
      for (let j = 0; j < BATCH_SIZE && (i + j) < CONFIG.journalEntries; j++) {
        const idx = i + j;
        const amount = randomAmount(100, 10000);
        const debitAccount = randomChoice(accounts);
        const creditAccount = randomChoice(accounts.filter(a => a.id !== debitAccount.id));
        const branch = randomChoice(CONFIG.branches as unknown as string[]);
        const date = new Date(2026, randomInt(0, 4), randomInt(1, 28));

        batch.push({
          entryNumber: `JE-${String(idx + 1).padStart(6, '0')}`,
          date,
          description: `قيد اختبار ${idx + 1}`,
          type: 'MANUAL',
          status: 'POSTED',
          branch,
          amount: parseFloat(amount),
          periodId: period.id,
          lines: {
            create: [
              { accountId: debitAccount.id, debit: parseFloat(amount), credit: 0 },
              { accountId: creditAccount.id, debit: 0, credit: parseFloat(amount) },
            ],
          },
        });
      }

      for (const entry of batch) {
        await prisma.journalEntry.create({ data: entry });
      }
      created += batch.length;
      if (created % 5000 === 0) console.log(`  ... ${created}/${CONFIG.journalEntries} journal entries`);
    }
  });

  return created;
}

// ─── Performance Tests ────────────────────────────────────────────

async function performanceTests() {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 PERFORMANCE TESTS');
  console.log('═'.repeat(60));

  // Test 1: Open POS screen (product list)
  await timeIt('POS Product List (first 50)', async () => {
    await prisma.product.findMany({
      take: 50,
      include: { category: true },
      orderBy: { sortOrder: 'asc' },
    });
  });

  // Test 2: Customer account statement
  const firstCustomer = await prisma.customer.findFirst();
  if (firstCustomer) {
    await timeIt('Customer Account Statement', async () => {
      await prisma.transaction.findMany({
        where: { customerId: firstCustomer.id },
        include: { journalEntries: { include: { lines: true } } },
        orderBy: { date: 'desc' },
        take: 100,
      });
    });
  }

  // Test 3: Income statement (revenue & expenses aggregation)
  await timeIt('Income Statement (Revenue aggregation)', async () => {
    const revenueAccounts = await prisma.account.findMany({
      where: { type: 'REVENUE', isActive: true },
      include: {
        journalLines: {
          where: { journalEntry: { status: 'POSTED' } },
          select: { debit: true, credit: true },
        },
      },
    });
  });

  // Test 4: Trial balance
  await timeIt('Trial Balance (all accounts with balances)', async () => {
    await prisma.account.findMany({
      where: { isActive: true, level: 1 },
      include: {
        journalLines: {
          where: { journalEntry: { status: 'POSTED' } },
          select: { debit: true, credit: true },
        },
        children: {
          include: {
            journalLines: {
              where: { journalEntry: { status: 'POSTED' } },
              select: { debit: true, credit: true },
            },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
  });

  // Test 5: Invoice search
  await timeIt('Invoice Search (by date range)', async () => {
    await prisma.pOSInvoice.findMany({
      where: {
        createdAt: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-12-31'),
        },
        status: 'FINALIZED',
      },
      include: { items: true, payments: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
  });

  // Test 6: Count queries
  await timeIt('Count: Invoices', async () => {
    await prisma.pOSInvoice.count({ where: { status: 'FINALIZED' } });
  });

  await timeIt('Count: Journal Entries', async () => {
    await prisma.journalEntry.count({ where: { status: 'POSTED' } });
  });

  await timeIt('Count: Products', async () => {
    await prisma.product.count();
  });

  // Test 7: Integrity check
  await timeIt('Database Integrity Check', async () => {
    await prisma.$queryRawUnsafe('PRAGMA integrity_check');
  });

  // Test 8: Database size
  await timeIt('Database File Size', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const dbPath = path.join(process.cwd(), 'db', 'custom.db');
    try {
      const stat = await fs.stat(dbPath);
      console.log(`  DB size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
    } catch {
      console.log('  Could not get DB size');
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60));
  console.log('🚀 ACCOUNTING SYSTEM STRESS TEST');
  console.log('═'.repeat(60));
  console.log(`Config: ${CONFIG.products} products, ${CONFIG.customers} customers, ${CONFIG.invoices} invoices, ${CONFIG.journalEntries} journal entries`);

  const totalStart = performance.now();

  try {
    // Phase 1: Setup
    await seedSettings();
    await seedBranches();
    await seedAdminUser();
    await seedAccounts();
    await seedFiscalPeriod();

    // Phase 2: Bulk data
    const categoryIds = await seedCategories();
    await seedProducts(categoryIds);
    await seedCustomers();

    // Phase 3: Transactional data
    await seedInvoices();
    await seedJournalEntries();

    // Phase 4: Performance tests
    await performanceTests();

  } catch (error) {
    console.error('\n❌ Stress test failed:', error);
  } finally {
    const totalElapsed = performance.now() - totalStart;
    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Stress test completed in ${(totalElapsed / 1000).toFixed(1)}s`);
    console.log('═'.repeat(60));
    await prisma.$disconnect();
  }
}

main();
