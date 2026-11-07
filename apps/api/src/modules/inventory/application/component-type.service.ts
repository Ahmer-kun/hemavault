import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class ComponentTypeService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.componentType.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.componentType.findUnique({ where: { id } });
  }
}

