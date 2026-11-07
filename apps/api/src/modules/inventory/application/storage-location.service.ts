import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class StorageLocationService {
  constructor(private readonly prisma: PrismaService) {}

  list(facilityId: string) {
    return this.prisma.storageLocation.findMany({ where: { facilityId, isActive: true }, orderBy: { code: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.storageLocation.findUnique({ where: { id } });
  }
}

