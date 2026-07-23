import { Controller, Get, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
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
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

@Controller('stock')
@UseGuards(PermissionsGuard)
export class StockController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  private corr(req: Request): string | undefined {
    const id = req.headers['x-correlation-id'] ?? (req as unknown as { id?: string }).id;
    return typeof id === 'string' ? id : undefined;
  }

  @Post('inbound')
  @RequirePermissions(PERMISSIONS.STOCK_INBOUND)
  inbound(@CurrentUser() user: JwtPayload, @Body() dto: InboundDto, @Req() req: Request) {
    return this.commandBus.execute(new InboundStockCommand(user.sub, user.companyId, dto, this.corr(req)));
  }

  @Post('outbound')
  @RequirePermissions(PERMISSIONS.STOCK_OUTBOUND)
  outbound(@CurrentUser() user: JwtPayload, @Body() dto: OutboundDto, @Req() req: Request) {
    return this.commandBus.execute(new OutboundStockCommand(user.sub, user.companyId, dto, this.corr(req)));
  }

  @Post('adjustment')
  @RequirePermissions(PERMISSIONS.STOCK_ADJUSTMENT)
  adjustment(@CurrentUser() user: JwtPayload, @Body() dto: AdjustmentDto, @Req() req: Request) {
    return this.commandBus.execute(new AdjustStockCommand(user.sub, user.companyId, dto, this.corr(req)));
  }

  @Post('transfer')
  @RequirePermissions(PERMISSIONS.STOCK_TRANSFER)
  transfer(@CurrentUser() user: JwtPayload, @Body() dto: TransferDto, @Req() req: Request) {
    return this.commandBus.execute(new TransferStockCommand(user.sub, user.companyId, dto, this.corr(req)));
  }

  @Get('balance/:productId/:warehouseId')
  @RequirePermissions(PERMISSIONS.VIEW_BALANCE)
  getBalance(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string,
  ) {
    return this.queryBus.execute(new GetBalanceQuery(user.companyId, productId, warehouseId));
  }

  @Get('movements/:productId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  getMovements(@CurrentUser() user: JwtPayload, @Param('productId') productId: string) {
    return this.queryBus.execute(new GetMovementHistoryQuery(user.companyId, productId));
  }
}
