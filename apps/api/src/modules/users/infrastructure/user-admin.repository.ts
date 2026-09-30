import { Injectable } from '@nestjs/common';
import { Prisma, Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';

export interface UserListItem {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  globalRoles: string[];
}

@Injectable()
export class UserAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserPage(
    search: string | null,
    limit: number,
    offset: number,
  ): Promise<{ items: UserListItem[]; total: number }> {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        include: { userRoles: { include: { role: { select: { code: true } } } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
    };
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateProfile(id: string, name: string | null): Promise<User | null> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return null;
    }
    return this.prisma.user.update({ where: { id }, data: { name } });
  }

  async findRoleByCode(code: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { code } });
  }

  async findUserRole(userId: string, roleId: string) {
    return this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId } },
    });
  }

  async createUserRole(userId: string, roleId: string, assignedById: string | null) {
    return this.prisma.userRole.create({ data: { userId, roleId, assignedById } });
  }

  async deleteUserRole(userRoleId: string): Promise<void> {
    await this.prisma.userRole.delete({ where: { id: userRoleId } });
  }

  async countsSuperAdmin(excludingUserId: string | null): Promise<number> {
    return this.prisma.userRole.count({
      where: {
        role: { code: 'PLATFORM_SUPER_ADMIN' },
        ...(excludingUserId ? { userId: { not: excludingUserId } } : {}),
      },
    });
  }

  private toListItem(row: User & { userRoles: { role: { code: string } }[] }): UserListItem {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      globalRoles: row.userRoles.map((assignment) => assignment.role.code),
    };
  }
}