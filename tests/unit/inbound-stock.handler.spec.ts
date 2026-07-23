import { InboundStockHandler } from '../../src/application/commands/inbound-stock.handler';
import { InboundStockCommand } from '../../src/application/commands/inbound-stock.command';
import { StockReceivedEvent } from '../../src/domain/events/stock-received.event';

describe('InboundStockHandler', () => {
  const stockService = {
    inbound: jest.fn(),
  };
  const emitter = { emit: jest.fn() };
  const cqrsBus = { publish: jest.fn() };

  const handler = new InboundStockHandler(
    stockService as never,
    emitter as never,
    cqrsBus as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('executes the stock service and emits StockReceivedEvent', async () => {
    stockService.inbound.mockResolvedValue({ runningBalance: '100.000000' });

    const cmd = new InboundStockCommand(
      'user-1', 'company-1',
      { productId: 'p1', warehouseId: 'w1', quantity: '100' } as never,
      'corr-1',
    );

    const result = await handler.execute(cmd);

    expect(stockService.inbound).toHaveBeenCalledWith('user-1', 'company-1', cmd.dto);
    expect(result.runningBalance).toBe('100.000000');
    expect(emitter.emit).toHaveBeenCalledWith(
      StockReceivedEvent.NAME,
      expect.objectContaining({
        productId: 'p1',
        warehouseId: 'w1',
        companyId: 'company-1',
        userId: 'user-1',
        quantity: '100',
        newBalance: '100.000000',
        correlationId: 'corr-1',
      }),
    );
    expect(cqrsBus.publish).toHaveBeenCalledTimes(1);
  });

  it('propagates ConflictException from the service', async () => {
    stockService.inbound.mockRejectedValue(new Error('Insufficient stock'));

    const cmd = new InboundStockCommand(
      'u', 'c',
      { productId: 'p', warehouseId: 'w', quantity: '1' } as never,
    );

    await expect(handler.execute(cmd)).rejects.toThrow('Insufficient stock');
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
