import { PrismaClient } from '@prisma/client';
import { seedAccessControl } from '../src/modules/rbac/infrastructure/access-control.seed';

let prisma: PrismaClient | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  prisma = new PrismaClient();
  await seedAccessControl(prisma);
  return async () => {
    await prisma?.$disconnect();
    prisma = null;
  };
}