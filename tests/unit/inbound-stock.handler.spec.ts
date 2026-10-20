import { InboundStockHandler } from '../../src/application/commands/inbound-stock.handler';
import { InboundStockCommand } from '../../src/application/commands/inbound-stock.command';

describe('InboundStockHandler', () => {
  const stockService = { inbound: jest.fn() };
  const fcmService = { sendStockNotification: jest.fn().mockResolvedValue(undefined) };

  const handler = new InboundStockHandler(
    stockService as never, { emit: jest.fn() } as never, { publish: jest.fn() } as never, fcmService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllMocks(); // for fcmService
  });

  it('calls stockService.inbound with correct arguments and returns its result', async () => {
    const mockResult = { runningBalance: '100.000000' };

    stockService.inbound.mockResolvedValue(mockResult);

    const cmd = new InboundStockCommand(
      'user-1', 'company-1',
      { productId: 'p1', warehouseId: 'w1', quantity: '100' } as never,
      'corr-1',
    );

    const result = await handler.execute(cmd);

    expect(stockService.inbound).toHaveBeenCalledWith('user-1', 'company-1', cmd.dto, { idempotencyKey: undefined });
    expect(result).toBe(mockResult);
    expect(fcmService.sendStockNotification).toHaveBeenCalledWith(
      'user-1',
      'STOCK_RECEIVED',
      'p1',
      100,
    );
  });

  it('propagates ConflictException from the service', async () => {
    stockService.inbound.mockRejectedValue(new Error('Insufficient stock'));

    const cmd = new InboundStockCommand(
      'u', 'c',
      { productId: 'p', warehouseId: 'w', quantity: '1' } as never,
    );

    await expect(handler.execute(cmd)).rejects.toThrow('Insufficient stock');
    expect(fcmService.sendStockNotification).not.toHaveBeenCalled();
  });
});