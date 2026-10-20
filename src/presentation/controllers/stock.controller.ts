import { BadRequestException, Controller, Get, Post, Param, Body, Req, UseGuards, Headers, Query } from '@nestjs/common';
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

@Controller('stock')
@UseGuards(PermissionsGuard)
export class StockController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly stock: StockService,
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
  @Get('changes/:warehouseId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  @WarehouseScoped('params.warehouseId')
  getChanges(
    @CurrentUser() user: JwtPayload,
    @Param('warehouseId') warehouseId: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
    @Query('anchor') anchor?: string,
  ) {
    return this.stock.getChanges(user.companyId, warehouseId, since, limit, anchor);
  }

  @Get('movements/:productId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  getMovements(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return this.queryBus.execute(new GetMovementHistoryQuery(user.companyId, productId, user.sub));
  }
}
