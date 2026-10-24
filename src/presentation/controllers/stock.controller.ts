import {
  BadRequestException, Controller, Get, Post, Param, Body, Req, UseGuards, Headers, Header, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { Request } from 'express';
import { InboundDto } from '../../application/dtos/stock/inbound.dto';
import { OutboundDto } from '../../application/dtos/stock/outbound.dto';
import { AdjustmentDto } from '../../application/dtos/stock/adjustment.dto';
import { TransferDto } from '../../application/dtos/stock/transfer.dto';
import { InboundStockCommand } from '../../application/commands/inbound-stock.command';
import { OutboundStockCommand } from '../../application/commands/outbound-stock.command';
import { AdjustStockCommand } from '../../application/commands/adjust-stock.command';
import { TransferStockCommand } from '../../application/commands/transfer-stock.command';
import { GetBalanceQuery } from '../../application/queries/get-balance.query';
import { GetMovementHistoryQuery } from '../../application/queries/get-movement-history.query';
import { CurrentUser, JwtPayload } from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { WarehouseScoped } from '../guards/warehouse-access.guard';
import { StockService } from '../../infrastructure/repositories/stock.service';
import { OperationLookupService } from '../../infrastructure/repositories/operation-lookup.service';
import { LookupOperationsDto } from '../../application/dtos/stock/operation-lookup.dto';
import { SkipAudit } from '../decorators/skip-audit.decorator';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Optional Idempotency-Key header (8-128 of A-Z a-z 0-9 _ -); a malformed key is refused, not ignored. */
function idempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!IDEMPOTENCY_KEY.test(raw)) {
    throw new BadRequestException('Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, _ or -');
  }
  return raw;
}
import { PERMISSIONS } from '../../shared/constants/permissions.constant';
import { ReplaceOperationDto } from '../../application/dtos/stock/replace-operation.dto';
import { ReplaceOperationCommand } from '../../application/commands/replace-operation.command';

function requiredKey(raw: string | undefined): string {
  const key = idempotencyKey(raw);
  if (key === undefined) throw new BadRequestException('Idempotency-Key is required for a replacement');
  return key;
}

@Controller('stock')
@UseGuards(PermissionsGuard)
export class StockController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly stock: StockService,
    private readonly operations: OperationLookupService,
  ) {}

  private corr(req: Request): string | undefined {
    const id = req.headers['x-correlation-id'] ?? (req as unknown as { id?: string }).id;
    return typeof id === 'string' ? id : undefined;
  }

  @Post('inbound')
  @RequirePermissions(PERMISSIONS.STOCK_INBOUND)
  @WarehouseScoped('body.warehouseId')
  inbound(
    @CurrentUser() user: JwtPayload, @Body() dto: InboundDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new InboundStockCommand(user.sub, user.companyId, dto, this.corr(req), idempotencyKey(key)),
    );
  }

  @Post('outbound')
  @RequirePermissions(PERMISSIONS.STOCK_OUTBOUND)
  @WarehouseScoped('body.warehouseId')
  outbound(
    @CurrentUser() user: JwtPayload, @Body() dto: OutboundDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new OutboundStockCommand(user.sub, user.companyId, dto, this.corr(req), idempotencyKey(key)),
    );
  }

  @Post('adjustment')
  @RequirePermissions(PERMISSIONS.STOCK_ADJUSTMENT)
  @WarehouseScoped('body.warehouseId')
  adjustment(
    @CurrentUser() user: JwtPayload, @Body() dto: AdjustmentDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new AdjustStockCommand(user.sub, user.companyId, dto, this.corr(req), idempotencyKey(key)),
    );
  }

  @Post('transfer')
  @RequirePermissions(PERMISSIONS.STOCK_TRANSFER)
  @WarehouseScoped('body.fromWarehouseId', 'body.toWarehouseId')
  transfer(
    @CurrentUser() user: JwtPayload, @Body() dto: TransferDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new TransferStockCommand(user.sub, user.companyId, dto, this.corr(req), idempotencyKey(key)),
    );
  }

  @Get('balance/:productId/:warehouseId')
  @RequirePermissions(PERMISSIONS.VIEW_BALANCE)
  @WarehouseScoped('params.warehouseId')
  getBalance(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    return this.queryBus.execute(new GetBalanceQuery(user.companyId, productId, warehouseId));
  }

  /**
   * Sync: what changed in a warehouse since the client's revision. Without `since` (or with a revision the server
   * never issued) the answer is a full balance snapshot. The returned `revision` and `anchor` are the cursor for the
   * next call; a cursor that no longer matches the server's history is answered with a snapshot and `reset: true`.
   */
  // no-store: a cached or revalidated (304) answer must never hide a change of history generation. The generation is
  // also part of every body, so the ETag changes with it.
  @Get('changes/:warehouseId')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  @WarehouseScoped('params.warehouseId')
  getChanges(
    @CurrentUser() user: JwtPayload,
    @Param('warehouseId') warehouseId: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
    @Query('anchor') anchor?: string,
    @Query('generation') generation?: string,
  ) {
    return this.stock.getChanges(user.companyId, warehouseId, since, limit, anchor, generation);
  }

  /**
   * Replaces an operation that the server's current history no longer holds (see StockReplacementService). The caller's
   * own earlier operation only; needs the permission of the movement kind and access to the warehouse; the Idempotency-Key
   * header (required) is the replacement's own key. Structured refusals carry `code` (409).
   */
  @Post('replacements/inbound')
  @RequirePermissions(PERMISSIONS.STOCK_INBOUND)
  @WarehouseScoped('body.warehouseId')
  replaceInbound(
    @CurrentUser() user: JwtPayload, @Body() dto: ReplaceOperationDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new ReplaceOperationCommand(user.sub, user.companyId, 'inbound', requiredKey(key), dto, this.corr(req)),
    );
  }

  @Post('replacements/outbound')
  @RequirePermissions(PERMISSIONS.STOCK_OUTBOUND)
  @WarehouseScoped('body.warehouseId')
  replaceOutbound(
    @CurrentUser() user: JwtPayload, @Body() dto: ReplaceOperationDto, @Req() req: Request,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commandBus.execute(
      new ReplaceOperationCommand(user.sub, user.companyId, 'outbound', requiredKey(key), dto, this.corr(req)),
    );
  }

  @Get('movements/:productId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  getMovements(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return this.queryBus.execute(new GetMovementHistoryQuery(user.companyId, productId, user.sub));
  }

  /**
   * Re-checks the caller's own earlier stock operations against the CURRENT history (after a sync reset, a client
   * asks whether what it once saw confirmed is still in the ledger). Read-only; scoped to the caller and to the
   * warehouses the caller may use now. See OperationLookupService for the meaning of each status.
   */
  @Post('operations/lookup')
  @HttpCode(HttpStatus.OK)
  @SkipAudit()
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  async lookupOperations(@CurrentUser() user: JwtPayload, @Body() dto: LookupOperationsDto) {
    return await this.operations.lookup(user.sub, user.companyId, dto.operations);
  }
}
