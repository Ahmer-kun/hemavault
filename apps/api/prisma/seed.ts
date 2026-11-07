import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOGUE } from '../src/modules/rbac/domain/permission-catalogue';
import { seedAccessControl } from '../src/modules/rbac/infrastructure/access-control.seed';
import { seedInventoryReferenceData } from '../src/modules/inventory/infrastructure/inventory-reference.seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedAccessControl(prisma);
    await seedInventoryReferenceData(prisma);
    const permissionCount = await prisma.permission.count();
    const roleCount = await prisma.role.count();
    const componentTypeCount = await prisma.componentType.count();
    console.log(
      `Seed complete. Permissions: ${permissionCount}/${PERMISSION_CATALOGUE.length}, roles: ${roleCount}, component types: ${componentTypeCount}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});