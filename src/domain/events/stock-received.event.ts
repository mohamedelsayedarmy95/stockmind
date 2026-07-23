export class StockReceivedEvent {
  static readonly NAME = 'stock.received';
  constructor(
    public readonly productId: string,
    public readonly warehouseId: string,
    public readonly companyId: string,
    public readonly userId: string,
    public readonly quantity: string,
    public readonly newBalance: string,
    public readonly correlationId?: string,
  ) {}
}
