import { ComponentCategory, PrismaClient } from '@prisma/client';

const DEFAULT_COMPONENT_TYPES = [
  { code: 'WHOLE_BLOOD', name: 'Whole Blood', category: ComponentCategory.WHOLE_BLOOD, shelfLifeDays: 35 },
  { code: 'RBC', name: 'Red Blood Cells', category: ComponentCategory.RED_CELLS, shelfLifeDays: 42 },
  { code: 'PLASMA', name: 'Plasma', category: ComponentCategory.PLASMA, shelfLifeDays: 365 },
  { code: 'PLATELETS', name: 'Platelets', category: ComponentCategory.PLATELETS, shelfLifeDays: 5 },
] as const;

export async function seedInventoryReferenceData(prisma: PrismaClient): Promise<void> {
  for (const ct of DEFAULT_COMPONENT_TYPES) {
    await prisma.componentType.upsert({
      where: { code: ct.code },
      update: { name: ct.name, category: ct.category, shelfLifeDays: ct.shelfLifeDays, isActive: true },
      create: { ...ct, isActive: true },
    });
  }
}
