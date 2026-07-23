export class StockIssuedEvent {
  static readonly NAME = 'stock.issued';
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
