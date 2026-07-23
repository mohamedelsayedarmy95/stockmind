export class StockAdjustedEvent {
  static readonly NAME = 'stock.adjusted';
  constructor(
    public readonly productId: string,
    public readonly warehouseId: string,
    public readonly companyId: string,
    public readonly userId: string,
    public readonly quantity: string,
    public readonly newBalance: string,
    public readonly reason: string,
    public readonly correlationId?: string,
  ) {}
}
