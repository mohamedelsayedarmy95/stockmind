import { OutboundStockHandler } from '../../src/application/commands/outbound-stock.handler';
import { OutboundStockCommand } from '../../src/application/commands/outbound-stock.command';

describe('OutboundStockHandler', () => {
  const stockService = { outbound: jest.fn() };
  const fcmService = { sendStockNotification: jest.fn().mockResolvedValue(undefined) };

  const handler = new OutboundStockHandler(
    stockService as never, { emit: jest.fn() } as never, { publish: jest.fn() } as never, fcmService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllMocks(); // for fcmService
  });

  it('calls stockService.outbound with correct arguments and returns its result', async () => {
    const mockResult = { runningBalance: '70.000000' };
    stockService.outbound.mockResolvedValue(mockResult);

    const result = await handler.execute(
      new OutboundStockCommand(
        'u1', 'c1',
        { productId: 'p1', warehouseId: 'w1', quantity: '30' } as never,
        'corr-x',
      ),
    );

    expect(stockService.outbound).toHaveBeenCalledWith('u1', 'c1', {
      productId: 'p1',
      warehouseId: 'w1',
      quantity: '30',
    });
    expect(fcmService.sendStockNotification).toHaveBeenCalledWith(
      'u1',
      'STOCK_SHIPPED',
      'p1',
      30,
    );
    expect(result).toBe(mockResult);
  });

  it('propagates ConflictException from the service', async () => {
    stockService.outbound.mockRejectedValue(new Error('Insufficient stock'));

    const cmd = new OutboundStockCommand(
      'u',
      'c',
      { productId: 'p', warehouseId: 'w', quantity: '1' } as never,
    );

    await expect(handler.execute(cmd)).rejects.toThrow('Insufficient stock');
    expect(fcmService.sendStockNotification).not.toHaveBeenCalled();
  });
});