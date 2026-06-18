import { db } from '../src/lib/db';

async function seed() {
  const branches = ['CHINA_TOWN', 'PALACE_INDIA'];
  let created = { categories: 0, products: 0, tables: 0 };

  for (const branch of branches) {
    const existingTables = await db.restaurantTable.count({ where: { branch } });
    if (existingTables === 0) {
      for (let i = 1; i <= 10; i++) {
        await db.restaurantTable.create({
          data: { name: String(i), branch, sortOrder: i, isActive: true },
        });
        created.tables++;
      }
    }

    const existingCategories = await db.productCategory.count({ where: { branch } });
    if (existingCategories === 0) {
      const sampleCategories = [
        { name: 'المشويات', nameEn: 'Grills', icon: '🍗', color: '#ef4444', products: [
          { name: 'دجاج مشوي', price: 35 }, { name: 'كباب لحم', price: 45 }, { name: 'شيش طاووق', price: 38 }, { name: 'ريش غنم', price: 65 }, { name: 'مشاوي مشكلة', price: 75 },
        ]},
        { name: 'البيتزا', nameEn: 'Pizza', icon: '🍕', color: '#f97316', products: [
          { name: 'بيتزا مارغريتا', price: 28 }, { name: 'بيتزا خضار', price: 32 }, { name: 'بيتزا لحم', price: 38 }, { name: 'بيتزا دجاج', price: 36 }, { name: 'بيتزا سي فود', price: 42 },
        ]},
        { name: 'المشروبات', nameEn: 'Beverages', icon: '🥤', color: '#3b82f6', products: [
          { name: 'بيبسي', price: 5 }, { name: 'كوكا كولا', price: 5 }, { name: 'ميرندا', price: 5 }, { name: 'عصير برتقال', price: 12 }, { name: 'عصير ليمون بالنعناع', price: 10 }, { name: 'ماء معدني', price: 3 },
        ]},
        { name: 'الحلويات', nameEn: 'Desserts', icon: '🍰', color: '#a855f7', products: [
          { name: 'كنافة', price: 18 }, { name: 'بقلاوة', price: 15 }, { name: 'تشيز كيك', price: 20 }, { name: 'آيس كريم', price: 12 },
        ]},
        { name: 'السلطات', nameEn: 'Salads', icon: '🥗', color: '#22c55e', products: [
          { name: 'سلطة خضراء', price: 12 }, { name: 'سلطة فتوش', price: 14 }, { name: 'سلطة تبولة', price: 14 }, { name: 'حمص', price: 10 }, { name: 'متبل', price: 10 },
        ]},
        { name: 'المقبلات', nameEn: 'Appetizers', icon: '🌮', color: '#eab308', products: [
          { name: 'سمبوسة لحم', price: 8 }, { name: 'سمبوسة جبن', price: 8 }, { name: 'فلافل', price: 10 }, { name: 'ورق عنب', price: 12 },
        ]},
        { name: 'الأرز والمخبوزات', nameEn: 'Rice & Breads', icon: '🍚', color: '#d97706', products: [
          { name: 'أرز بسمتي', price: 10 }, { name: 'أرز كبسة', price: 15 }, { name: 'خبز عربي', price: 3 }, { name: 'خبز تورتيلا', price: 5 },
        ]},
        { name: 'القهوة والشاي', nameEn: 'Coffee & Tea', icon: '☕', color: '#78716c', products: [
          { name: 'قهوة عربية', price: 8 }, { name: 'قهوة تركية', price: 10 }, { name: 'شاي أحمر', price: 5 }, { name: 'شاي أخضر', price: 6 }, { name: 'نسكافيه', price: 10 },
        ]},
      ];

      for (let i = 0; i < sampleCategories.length; i++) {
        const catData = sampleCategories[i];
        const category = await db.productCategory.create({
          data: { name: catData.name, nameEn: catData.nameEn, branch, icon: catData.icon, color: catData.color, sortOrder: i, isActive: true },
        });
        created.categories++;
        for (let j = 0; j < catData.products.length; j++) {
          const p = catData.products[j];
          await db.product.create({ data: { name: p.name, categoryId: category.id, branch, price: p.price, sortOrder: j, isActive: true } });
          created.products++;
        }
      }
    }
  }
  console.log('Seeded:', JSON.stringify(created));
  await db.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
