import { PrismaClient } from '@prisma/client';
import { PERMISSION_CATALOGUE } from '../src/modules/rbac/domain/permission-catalogue';
import { seedAccessControl } from '../src/modules/rbac/infrastructure/access-control.seed';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedAccessControl(prisma);
    const permissionCount = await prisma.permission.count();
    const roleCount = await prisma.role.count();
    console.log(
      `Seed complete. Permissions: ${permissionCount}/${PERMISSION_CATALOGUE.length}, roles: ${roleCount}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});