import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireRole } from '@/lib/api-auth';
import { resolveBranchId } from '@/lib/branch-resolver';

// POST /api/pos/seed - Seed sample POS data (categories, products, tables)
export async function POST() {
  try {
    const auth = await requireRole('ADMIN'); if (!auth.authenticated) return auth.response;
    const branchCodes = ['CHINA_TOWN', 'PALACE_INDIA'];
    let created = { categories: 0, products: 0, tables: 0, branches: 0 };

    // Seed branches if not already seeded
    const existingBranches = await db.branch.count();
    if (existingBranches === 0) {
      await db.branch.createMany({
        data: [
          { code: 'CHINA_TOWN', name: 'تشاينا تاون', nameEn: 'China Town', sortOrder: 1, isActive: true },
          { code: 'PALACE_INDIA', name: 'بالاس إنديا', nameEn: 'Palace India', sortOrder: 2, isActive: true },
        ],
      });
      created.branches = 2;
    }

    // Resolve branch codes to branchIds (UUIDs)
    const branchIds: string[] = [];
    for (const code of branchCodes) {
      try {
        const id = await resolveBranchId(code);
        branchIds.push(id);
      } catch {
        // skip missing branches
      }
    }

    for (const branchId of branchIds) {
      // Check if tables already exist for this branch
      const existingTables = await db.restaurantTable.count({
        where: { branchId },
      });

      if (existingTables === 0) {
        // Create 10 tables per branch
        for (let i = 1; i <= 10; i++) {
          await db.restaurantTable.create({
            data: {
              name: String(i),
              branchId,
              sortOrder: i,
              isActive: true,
            },
          });
          created.tables++;
        }
      }

      // Check if categories already exist for this branch
      const existingCategories = await db.productCategory.count({
        where: { branchId },
      });

      if (existingCategories === 0) {
        // Create sample categories and products
        const sampleCategories = [
          { name: 'المشويات', nameEn: 'Grills', icon: '🍗', color: '#ef4444', products: [
            { name: 'دجاج مشوي', nameEn: 'Grilled Chicken', price: 35 },
            { name: 'كباب لحم', nameEn: 'Beef Kebab', price: 45 },
            { name: 'شيش طاووق', nameEn: 'Shish Tawook', price: 38 },
            { name: 'ريش غنم', nameEn: 'Lamb Chops', price: 65 },
            { name: 'مشاوي مشكلة', nameEn: 'Mixed Grill', price: 75 },
          ]},
          { name: 'البيتزا', nameEn: 'Pizza', icon: '🍕', color: '#f97316', products: [
            { name: 'بيتزا مارغريتا', nameEn: 'Margherita Pizza', price: 28 },
            { name: 'بيتزا خضار', nameEn: 'Vegetable Pizza', price: 32 },
            { name: 'بيتزا لحم', nameEn: 'Meat Pizza', price: 38 },
            { name: 'بيتزا دجاج', nameEn: 'Chicken Pizza', price: 36 },
            { name: 'بيتزا سي فود', nameEn: 'Seafood Pizza', price: 42 },
          ]},
          { name: 'المشروبات', nameEn: 'Beverages', icon: '🥤', color: '#3b82f6', products: [
            { name: 'بيبسي', nameEn: 'Pepsi', price: 5 },
            { name: 'كوكا كولا', nameEn: 'Coca Cola', price: 5 },
            { name: 'ميرندا', nameEn: 'Mirinda', price: 5 },
            { name: 'عصير برتقال', nameEn: 'Orange Juice', price: 12 },
            { name: 'عصير ليمون بالنعناع', nameEn: 'Lemon Mint Juice', price: 10 },
            { name: 'ماء معدني', nameEn: 'Mineral Water', price: 3 },
          ]},
          { name: 'الحلويات', nameEn: 'Desserts', icon: '🍰', color: '#a855f7', products: [
            { name: 'كنافة', nameEn: 'Kunafa', price: 18 },
            { name: 'بقلاوة', nameEn: 'Baklava', price: 15 },
            { name: 'تشيز كيك', nameEn: 'Cheesecake', price: 20 },
            { name: 'آيس كريم', nameEn: 'Ice Cream', price: 12 },
          ]},
          { name: 'السلطات', nameEn: 'Salads', icon: '🥗', color: '#22c55e', products: [
            { name: 'سلطة خضراء', nameEn: 'Green Salad', price: 12 },
            { name: 'سلطة فتوش', nameEn: 'Fattoush Salad', price: 14 },
            { name: 'سلطة تبولة', nameEn: 'Tabbouleh Salad', price: 14 },
            { name: 'حمص', nameEn: 'Hummus', price: 10 },
            { name: 'متبل', nameEn: 'Moutabal', price: 10 },
          ]},
          { name: 'المقبلات', nameEn: 'Appetizers', icon: '🌮', color: '#eab308', products: [
            { name: 'سمبوسة لحم', nameEn: 'Meat Samosa', price: 8 },
            { name: 'سمبوسة جبن', nameEn: 'Cheese Samosa', price: 8 },
            { name: 'فلافل', nameEn: 'Falafel', price: 10 },
            { name: 'ورق عنب', nameEn: 'Grape Leaves', price: 12 },
          ]},
          { name: 'الأرز والمخبوزات', nameEn: 'Rice & Breads', icon: '🍚', color: '#d97706', products: [
            { name: 'أرز بسمتي', nameEn: 'Basmati Rice', price: 10 },
            { name: 'أرز كبسة', nameEn: 'Kabsa Rice', price: 15 },
            { name: 'خبز عربي', nameEn: 'Arabic Bread', price: 3 },
            { name: 'خبز تورتيلا', nameEn: 'Tortilla Bread', price: 5 },
          ]},
          { name: 'القهوة والشاي', nameEn: 'Coffee & Tea', icon: '☕', color: '#78716c', products: [
            { name: 'قهوة عربية', nameEn: 'Arabic Coffee', price: 8 },
            { name: 'قهوة تركية', nameEn: 'Turkish Coffee', price: 10 },
            { name: 'شاي أحمر', nameEn: 'Red Tea', price: 5 },
            { name: 'شاي أخضر', nameEn: 'Green Tea', price: 6 },
            { name: 'نسكافيه', nameEn: 'Nescafe', price: 10 },
          ]},
        ];

        for (let i = 0; i < sampleCategories.length; i++) {
          const catData = sampleCategories[i];
          const category = await db.productCategory.create({
            data: {
              name: catData.name,
              nameEn: catData.nameEn,
              branchId,
              icon: catData.icon,
              color: catData.color,
              sortOrder: i,
              isActive: true,
            },
          });
          created.categories++;

          // Create products for this category
          for (let j = 0; j < catData.products.length; j++) {
            const prodData = catData.products[j];
            await db.product.create({
              data: {
                name: prodData.name,
                nameEn: prodData.nameEn,
                categoryId: category.id,
                branchId,
                price: prodData.price,
                sortOrder: j,
                isActive: true,
              },
            });
            created.products++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء البيانات التجريبية بنجاح',
      created,
    });
  } catch (error: any) {
    console.error('Error seeding POS data:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء البيانات التجريبية' },
      { status: 500 }
    );
  }
}
