/**
 * Every stock write and product creation emits its domain event, as production (bb071ed) does. The listeners write
 * the STOCK_RECEIVED / STOCK_ISSUED / PRODUCT_CREATED audit rows, so a handler that stops emitting silently loses the
 * audit trail. The FCM change (6967d46) had replaced the events with a direct push; both are kept now.
 */
import { InboundStockHandler } from '../../src/application/commands/inbound-stock.handler';
import { InboundStockCommand } from '../../src/application/commands/inbound-stock.command';
import { OutboundStockHandler } from '../../src/application/commands/outbound-stock.handler';
import { OutboundStockCommand } from '../../src/application/commands/outbound-stock.command';
import { AdjustStockHandler } from '../../src/application/commands/adjust-stock.handler';
import { AdjustStockCommand } from '../../src/application/commands/adjust-stock.command';
import { CreateProductHandler } from '../../src/application/commands/create-product.handler';
import { CreateProductCommand } from '../../src/application/commands/create-product.command';
import { StockReceivedEvent } from '../../src/domain/events/stock-received.event';
import { StockIssuedEvent } from '../../src/domain/events/stock-issued.event';
import { StockAdjustedEvent } from '../../src/domain/events/stock-adjusted.event';
import { ProductCreatedEvent } from '../../src/domain/events/product-created.event';

const deps = () => ({
  events: { emit: jest.fn() },
  bus: { publish: jest.fn() },
  fcm: { sendStockNotification: jest.fn().mockResolvedValue(undefined) },
});
// Built through `any` so the test states the dependencies by role, independent of the constructor signature in use.
const build = (Handler: unknown, service: unknown, d: ReturnType<typeof deps>) =>
  new (Handler as new (...a: unknown[]) => { execute: (c: unknown) => Promise<unknown> })(service, d.events, d.bus, d.fcm);

const stockDto = { productId: 'p1', warehouseId: 'w1', quantity: '25', reason: 'count' };

describe.each([
  ['inbound', InboundStockHandler, InboundStockCommand, 'inbound', StockReceivedEvent, 'STOCK_RECEIVED'],
  ['outbound', OutboundStockHandler, OutboundStockCommand, 'outbound', StockIssuedEvent, 'STOCK_SHIPPED'],
  ['adjustment', AdjustStockHandler, AdjustStockCommand, 'adjustment', StockAdjustedEvent, 'STOCK_ADJUSTED'],
])('%s', (_name, Handler, Command, method, Event, pushType) => {
  it('emits and publishes its domain event with the new balance, sends one push, returns the movement', async () => {
    const d = deps();
    const movement = { id: 'm1', runningBalance: '75.000000' };
    const service = { [method]: jest.fn().mockResolvedValue(movement) };
    const cmd = new (Command as new (...a: unknown[]) => object)('u1', 'c1', stockDto, 'corr-1');

    await expect(build(Handler, service, d).execute(cmd)).resolves.toBe(movement);

    const EventClass = Event as unknown as { NAME: string } & (new (...a: unknown[]) => object);
    expect(d.events.emit).toHaveBeenCalledTimes(1);
    const [name, event] = d.events.emit.mock.calls[0];
    expect(name).toBe(EventClass.NAME);
    expect(event).toBeInstanceOf(EventClass);
    expect(event).toMatchObject({ productId: 'p1', warehouseId: 'w1', companyId: 'c1', userId: 'u1',
      quantity: '25', newBalance: '75.000000', correlationId: 'corr-1' });
    expect(d.bus.publish).toHaveBeenCalledWith(event);
    expect(d.fcm.sendStockNotification).toHaveBeenCalledTimes(1);
    expect(d.fcm.sendStockNotification.mock.calls[0].slice(0, 3)).toEqual(['u1', pushType, 'p1']);
  });

  it('a failed write emits nothing and sends nothing', async () => {
    const d = deps();
    const service = { [method]: jest.fn().mockRejectedValue(new Error('Insufficient stock')) };
    const cmd = new (Command as new (...a: unknown[]) => object)('u1', 'c1', stockDto, 'corr-1');

    await expect(build(Handler, service, d).execute(cmd)).rejects.toThrow('Insufficient stock');
    expect(d.events.emit).not.toHaveBeenCalled();
    expect(d.bus.publish).not.toHaveBeenCalled();
    expect(d.fcm.sendStockNotification).not.toHaveBeenCalled();
  });
});

describe('create product', () => {
  it('emits and publishes ProductCreatedEvent and returns the product', async () => {
    const d = deps();
    const product = { id: 'prod-1', sku: 'SKU-1' };
    const service = { create: jest.fn().mockResolvedValue(product) };
    const cmd = new CreateProductCommand('u1', 'c1', { name: 'N', sku: 'SKU-1' } as never, 'corr-2');

    await expect(build(CreateProductHandler, service, d).execute(cmd)).resolves.toBe(product);

    const [name, event] = d.events.emit.mock.calls[0];
    expect(name).toBe(ProductCreatedEvent.NAME);
    expect(event).toMatchObject({ productId: 'prod-1', companyId: 'c1', userId: 'u1', sku: 'SKU-1',
      correlationId: 'corr-2' });
    expect(d.bus.publish).toHaveBeenCalledWith(event);
  });
});
