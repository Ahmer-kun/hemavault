import type { PrismaClient } from '@prisma/client';
import {
  assertCatalogueIntegrity,
  PERMISSION_CATALOGUE,
  ROLE_DEFINITIONS,
} from '../domain/permission-catalogue';

/**
 * Idempotently synchronizes the permission/role catalogue into the database.
 * The catalogue constants are the single source of truth; this writer keeps
 * the persisted rows, system roles, and role->permission mapping in sync.
 */
export async function seedAccessControl(prisma: PrismaClient): Promise<void> {
  const problems = assertCatalogueIntegrity();
  if (problems.length > 0) {
    throw new Error(`Access-control catalogue integrity failed: ${problems.join('; ')}`);
  }

  for (const permission of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { category: permission.category, description: permission.description },
      create: {
        code: permission.code,
        category: permission.category,
        description: permission.description,
      },
    });
  }

  for (const role of ROLE_DEFINITIONS) {
    const persisted = await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: true,
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: true,
      },
    });

    await prisma.rolePermission.deleteMany({
      where: {
        roleId: persisted.id,
        permission: { code: { notIn: [...role.permissions] } },
      },
    });

    const targetPermissions = await prisma.permission.findMany({
      where: { code: { in: [...role.permissions] } },
      select: { id: true },
    });
    if (targetPermissions.length !== role.permissions.length) {
      throw new Error(`Role ${role.code} references permissions missing from the catalogue.`);
    }

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: persisted.id },
      select: { permissionId: true },
    });
    const existingIds = new Set(existing.map((item) => item.permissionId));
    const missingIds = targetPermissions
      .map((permission) => permission.id)
      .filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: missingIds.map((permissionId) => ({ roleId: persisted.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
}