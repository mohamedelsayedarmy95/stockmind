import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Company } from '../domain/entities/company.entity';
import { Warehouse } from '../domain/entities/warehouse.entity';
import { User } from '../domain/entities/user.entity';
import { Category } from '../domain/entities/category.entity';
import { Product } from '../domain/entities/product.entity';
import { UnitOfMeasure } from '../domain/entities/unit-of-measure.entity';
import { ProductWarehouse } from '../domain/entities/product-warehouse.entity';
import { StockMovement } from '../domain/entities/stock-movement.entity';
import { Role } from '../domain/entities/role.entity';
import { Permission } from '../domain/entities/permission.entity';
import { RolePermission } from '../domain/entities/role-permission.entity';
import { UserRoleLink } from '../domain/entities/user-role.entity';
import { UserRole } from '../shared/constants/enums';
import { DEFAULT_ROLE_PERMISSIONS } from '../shared/constants/permissions.constant';

dotenv.config();

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'stockmind',
    password: process.env.DB_PASSWORD ?? 'stockmind123',
    database: process.env.DB_DATABASE ?? 'stockmind',
    entities: [
      Company, Warehouse, User, Category, Product, UnitOfMeasure,
      ProductWarehouse, StockMovement,
      Role, Permission, RolePermission, UserRoleLink,
    ],
    synchronize: false,
  });

  await ds.initialize();
  console.log('Connected to database');

  const companyRepo = ds.getRepository(Company);
  const warehouseRepo = ds.getRepository(Warehouse);
  const userRepo = ds.getRepository(User);
  const categoryRepo = ds.getRepository(Category);
  const productRepo = ds.getRepository(Product);
  const uomRepo = ds.getRepository(UnitOfMeasure);

  // ── Company ─────────────────────────────────────────
  const company = await companyRepo.save(
    companyRepo.create({ name: 'StockMind Demo Co.', taxId: 'TAX-12345', currency: 'USD' }),
  );
  console.log(`Company created: ${company.name} (${company.id})`);

  // ── Warehouses ──────────────────────────────────────
  const mainWh = await warehouseRepo.save(
    warehouseRepo.create({ companyId: company.id, name: 'Main Warehouse', address: '123 Industrial Ave' }),
  );
  const coldWh = await warehouseRepo.save(
    warehouseRepo.create({ companyId: company.id, name: 'Cold Storage', address: '456 Refrigeration Blvd' }),
  );
  console.log(`Warehouses created: ${mainWh.name}, ${coldWh.name}`);

  // ── Admin User ──────────────────────────────────────
  const hash = await bcrypt.hash('admin123', 12);
  const admin = await userRepo.save(
    userRepo.create({
      companyId: company.id,
      warehouseId: mainWh.id,
      name: 'Admin User',
      email: 'admin@stockmind.io',
      passwordHash: hash,
      role: UserRole.ADMIN,
    }),
  );
  console.log(`Admin user created: ${admin.email} / admin123`);

  // ── Categories ──────────────────────────────────────
  const electronics = await categoryRepo.save(
    categoryRepo.create({ companyId: company.id, name: 'Electronics' }),
  );
  const cables = await categoryRepo.save(
    categoryRepo.create({ companyId: company.id, name: 'Cables', parentId: electronics.id }),
  );
  const food = await categoryRepo.save(
    categoryRepo.create({ companyId: company.id, name: 'Food & Beverage' }),
  );
  console.log(`Categories created: ${electronics.name}, ${cables.name}, ${food.name}`);

  // ── Products ────────────────────────────────────────
  const productA = await productRepo.save(
    productRepo.create({
      companyId: company.id,
      categoryId: electronics.id,
      name: 'Product A — USB-C Cable',
      sku: 'PROD-A-001',
      barcode: '8901234567890',
    }),
  );
  await uomRepo.save(
    uomRepo.create({ productId: productA.id, uomType: 'piece', code: 'PCS', conversionFactorToBase: '1' }),
  );
  await uomRepo.save(
    uomRepo.create({ productId: productA.id, uomType: 'carton', code: 'CTN', conversionFactorToBase: '24' }),
  );

  const productB = await productRepo.save(
    productRepo.create({
      companyId: company.id,
      categoryId: food.id,
      name: 'Product B — Organic Coffee 1kg',
      sku: 'PROD-B-001',
      barcode: '8907654321098',
      weight: '1.000000',
    }),
  );
  await uomRepo.save(
    uomRepo.create({ productId: productB.id, uomType: 'piece', code: 'PCS', conversionFactorToBase: '1' }),
  );
  await uomRepo.save(
    uomRepo.create({ productId: productB.id, uomType: 'ton', code: 'TON', conversionFactorToBase: '1000' }),
  );

  console.log(`Products created: ${productA.name}, ${productB.name}`);

  // ── RBAC: seed roles + link admin ───────────────────
  const roleRepo = ds.getRepository(Role);
  const permRepo = ds.getRepository(Permission);
  const rolePermRepo = ds.getRepository(RolePermission);
  const userRoleRepo = ds.getRepository(UserRoleLink);

  const allPermissions = await permRepo.find();
  const permByName = new Map(allPermissions.map((p) => [p.name, p]));

  for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await roleRepo.save(
      roleRepo.create({ companyId: company.id, name: roleName, isSystem: true }),
    );
    for (const p of perms) {
      const perm = permByName.get(p);
      if (!perm) continue;
      await rolePermRepo.save(rolePermRepo.create({ roleId: role.id, permissionId: perm.id }));
    }
    if (roleName === 'Admin') {
      await userRoleRepo.save(userRoleRepo.create({ userId: admin.id, roleId: role.id }));
    }
  }
  console.log('RBAC roles seeded (Admin, Manager, Staff) and admin linked to Admin role');

  // ── Summary ─────────────────────────────────────────
  console.log('\n========================================');
  console.log('  Seed completed successfully!');
  console.log('========================================');
  console.log(`  Login with: admin@stockmind.io / admin123`);
  console.log(`  Company ID:   ${company.id}`);
  console.log(`  Warehouse ID: ${mainWh.id}`);
  console.log(`  Product A ID: ${productA.id}`);
  console.log(`  Product B ID: ${productB.id}`);
  console.log('========================================\n');

  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
