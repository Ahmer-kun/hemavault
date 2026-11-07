import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppHttpException } from '../../../common/errors/app-http.exception';
import { CsrfGuard } from '../../auth/presentation/csrf.guard';
import type { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import type { ActorContext } from '../../rbac/domain/policy';
import { canGlobally, isMemberOfFacility } from '../../rbac/domain/policy';
import { CurrentActor, RequireAnywhere } from '../../rbac/presentation/permissions.decorators';
import { UnitService } from '../application/unit.service';
import { ComponentTypeService } from '../application/component-type.service';
import { StorageLocationService } from '../application/storage-location.service';
import { ReconciliationService } from '../application/reconciliation.service';
import { MoveUnitDto } from '../dto/move-unit.dto';
import { AuditService } from '../../../common/audit/audit.service';

interface Envelope<T> {
  data: T;
  meta: { requestId: string };
}

@Controller('api/v1/inventory')
export class InventoryController {
  constructor(
    private readonly unitService: UnitService,
    private readonly componentTypeService: ComponentTypeService,
    private readonly storageLocationService: StorageLocationService,
    private readonly reconciliationService: ReconciliationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('units')
  @RequireAnywhere('inventory.read')
  async list(
    @CurrentActor() actor: ActorContext,
    @Query('facilityId') facilityId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const effectiveFacilityId = this.resolveFacilityScope(actor, facilityId);
    const data = await this.unitService.list(effectiveFacilityId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('units/:unitId')
  @RequireAnywhere('inventory.read')
  async get(
    @CurrentActor() actor: ActorContext,
    @Param('unitId') unitId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.unitService.findById(unitId);
    if (!data) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, data.facilityId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('summary')
  @RequireAnywhere('inventory.read')
  async summary(@Req() req: AuthenticatedRequest): Promise<Envelope<unknown>> {
    const data = await this.unitService.summary();
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('expiring')
  @RequireAnywhere('inventory.read')
  async expiring(
    @Query('days', new ParseIntPipe({ optional: true })) days: number | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const data = await this.unitService.expiring(days ?? 7);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('units/:unitId/move')
  @RequireAnywhere('inventory.move')
  @UseGuards(CsrfGuard)
  async move(
    @CurrentActor() actor: ActorContext,
    @Param('unitId') unitId: string,
    @Body() dto: MoveUnitDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const unit = await this.unitService.findById(unitId);
    if (!unit) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, unit.facilityId);
    const data = await this.unitService.move(
      unitId,
      dto.toState,
      dto.movementType ?? 'STATE_CHANGE',
      actor.userId,
      dto.reason,
    );
    await this.audit(actor, req, 'INVENTORY_UNIT_MOVED', 'BloodComponentUnit', unitId, unit.facilityId, {
      toState: dto.toState,
      movementType: dto.movementType ?? 'STATE_CHANGE',
      reason: dto.reason ?? null,
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('units/:unitId/quarantine')
  @RequireAnywhere('inventory.quarantine')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async quarantine(
    @CurrentActor() actor: ActorContext,
    @Param('unitId') unitId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const unit = await this.unitService.findById(unitId);
    if (!unit) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, unit.facilityId);
    const data = await this.unitService.quarantine(unitId, actor.userId);
    await this.audit(actor, req, 'INVENTORY_UNIT_QUARANTINED', 'BloodComponentUnit', unitId, unit.facilityId);
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('units/:unitId/discard')
  @RequireAnywhere('inventory.discard')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async discard(
    @CurrentActor() actor: ActorContext,
    @Param('unitId') unitId: string,
    @Body() body: { reason?: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const unit = await this.unitService.findById(unitId);
    if (!unit) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, unit.facilityId);
    if (!body?.reason?.trim()) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, 'DISCARD_REASON_REQUIRED', 'A reason is required to discard a unit.');
    }
    const data = await this.unitService.discard(unitId, actor.userId, body.reason.trim());
    await this.audit(actor, req, 'INVENTORY_UNIT_DISCARDED', 'BloodComponentUnit', unitId, unit.facilityId, { reason: body.reason.trim() });
    return { data, meta: { requestId: req.requestId } };
  }

  @Post('reconcile')
  @RequireAnywhere('inventory.reconcile')
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  async reconcile(
    @CurrentActor() actor: ActorContext,
    @Body() body: { unitId: string; toState: string; reason?: string },
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    if (!body?.unitId || !body?.toState) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, 'RECONCILIATION_INPUT_REQUIRED', 'unitId and toState are required.');
    }
    if (!body.reason?.trim()) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, 'RECONCILIATION_REASON_REQUIRED', 'A reason is required for inventory reconciliation.');
    }
    const unit = await this.unitService.findById(body.unitId);
    if (!unit) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, unit.facilityId);
    // Reconciliation is a documented corrective path; it still produces an append-only
    // movement record and must be audited. We intentionally do not bypass movement logging or state validation.
    const data = await this.reconciliationService.reconcile(body.unitId, body.toState as any, actor.userId, body.reason.trim());
    await this.audit(actor, req, 'INVENTORY_RECONCILED', 'BloodComponentUnit', body.unitId, unit.facilityId, {
      fromState: (unit as any).state,
      toState: body.toState,
      reason: body.reason.trim(),
    });
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('units/:unitId/movements')
  @RequireAnywhere('inventory.read')
  async movements(
    @CurrentActor() actor: ActorContext,
    @Param('unitId') unitId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    const unit = await this.unitService.findById(unitId);
    if (!unit) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
    this.assertCanAccessFacility(actor, unit.facilityId);
    return { data: (unit as any).movements ?? [], meta: { requestId: req.requestId } };
  }

  @Get('component-types')
  @RequireAnywhere('inventory.read')
  async componentTypes(@Req() req: AuthenticatedRequest): Promise<Envelope<unknown>> {
    const data = await this.componentTypeService.list();
    return { data, meta: { requestId: req.requestId } };
  }

  @Get('storage-locations')
  @RequireAnywhere('inventory.read')
  async storageLocations(
    @CurrentActor() actor: ActorContext,
    @Query('facilityId') facilityId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<Envelope<unknown>> {
    if (!facilityId) {
      throw new AppHttpException(HttpStatus.BAD_REQUEST, 'FACILITY_ID_REQUIRED', 'facilityId is required.');
    }
    this.assertCanAccessFacility(actor, facilityId);
    const data = await this.storageLocationService.list(facilityId);
    return { data, meta: { requestId: req.requestId } };
  }

  private resolveFacilityScope(actor: ActorContext, requestedFacilityId?: string): string | undefined {
    if (requestedFacilityId) {
      this.assertCanAccessFacility(actor, requestedFacilityId);
      return requestedFacilityId;
    }
    return undefined;
  }

  private assertCanAccessFacility(actor: ActorContext, facilityId: string): void {
    if (canGlobally(actor, 'inventory.read') || canGlobally(actor, 'inventory.manage')) return;
    if (!isMemberOfFacility(actor, facilityId)) {
      throw new AppHttpException(HttpStatus.NOT_FOUND, 'INVENTORY_UNIT_NOT_FOUND', 'Inventory unit not found.');
    }
  }

  private async audit(
    actor: ActorContext,
    req: AuthenticatedRequest,
    action: string,
    targetType: string,
    targetId: string,
    facilityId: string | null | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      facilityId: facilityId ?? null,
      requestId: req.requestId,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers?.['user-agent'] as string) ?? null,
      metadata: metadata ?? null,
    });
  }
}
