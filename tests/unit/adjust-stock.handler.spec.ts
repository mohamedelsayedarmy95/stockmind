// adjust-stock.handler.spec.ts
import { AdjustStockHandler } from '../../src/application/commands/adjust-stock.handler';
import { AdjustStockCommand } from '../../src/application/commands/adjust-stock.command';

describe('AdjustStockHandler', () => {
  const stockService = { adjustment: jest.fn() };
  const fcmService = { sendStockNotification: jest.fn().mockResolvedValue(undefined) };

  const handler = new AdjustStockHandler(
    stockService as never, { emit: jest.fn() } as never, { publish: jest.fn() } as never, fcmService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllMocks(); // for fcmService
  });

  it('calls stockService.adjustment with correct arguments and returns its result', async () => {
    const mockResult = { runningBalance: '50.000000' };
    stockService.adjustment.mockResolvedValue(mockResult);

    const result = await handler.execute(
      new AdjustStockCommand(
        'u1', 'c1',
        { productId: 'p1', warehouseId: 'w1', quantity: '20' } as never,
      ),
    );

    expect(stockService.adjustment).toHaveBeenCalledWith('u1', 'c1', {
      productId: 'p1',
      warehouseId: 'w1',
      quantity: '20',
    });
    expect(fcmService.sendStockNotification).toHaveBeenCalledWith(
      'u1',
      'STOCK_ADJUSTED',
      'p1',
      20,
    );
    expect(result).toBe(mockResult);
  });

  it('propagates ConflictException from the service', async () => {
    stockService.adjustment.mockRejectedValue(new Error('Invalid adjustment'));

    const cmd = new AdjustStockCommand(
      'u',
      'c',
      { productId: 'p', warehouseId: 'w', quantity: '-5' } as never,
    );

    await expect(handler.execute(cmd)).rejects.toThrow('Invalid adjustment');
    expect(fcmService.sendStockNotification).not.toHaveBeenCalled();
  });
});