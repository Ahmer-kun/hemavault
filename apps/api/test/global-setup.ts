import { PrismaClient } from '@prisma/client';
import { seedAccessControl } from '../src/modules/rbac/infrastructure/access-control.seed';
import { seedInventoryReferenceData } from '../src/modules/inventory/infrastructure/inventory-reference.seed';

let prisma: PrismaClient | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  prisma = new PrismaClient();
  await seedAccessControl(prisma);
  await seedInventoryReferenceData(prisma);
  return async () => {
    await prisma?.$disconnect();
    prisma = null;
  };
}