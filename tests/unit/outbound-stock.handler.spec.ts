import { OutboundStockHandler } from '../../src/application/commands/outbound-stock.handler';
import { OutboundStockCommand } from '../../src/application/commands/outbound-stock.command';
import { StockIssuedEvent } from '../../src/domain/events/stock-issued.event';

describe('OutboundStockHandler', () => {
  const stockService = { outbound: jest.fn() };
  const emitter = { emit: jest.fn() };
  const cqrsBus = { publish: jest.fn() };

  const handler = new OutboundStockHandler(
    stockService as never, emitter as never, cqrsBus as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('emits StockIssuedEvent on success', async () => {
    stockService.outbound.mockResolvedValue({ runningBalance: '70.000000' });

    await handler.execute(
      new OutboundStockCommand(
        'u1', 'c1',
        { productId: 'p1', warehouseId: 'w1', quantity: '30' } as never,
        'corr-x',
      ),
    );

    expect(emitter.emit).toHaveBeenCalledWith(
      StockIssuedEvent.NAME,
      expect.objectContaining({ newBalance: '70.000000', correlationId: 'corr-x' }),
    );
  });
});
