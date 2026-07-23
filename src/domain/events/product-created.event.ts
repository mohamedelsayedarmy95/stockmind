export class ProductCreatedEvent {
  static readonly NAME = 'product.created';
  constructor(
    public readonly productId: string,
    public readonly companyId: string,
    public readonly userId: string,
    public readonly sku: string,
    public readonly correlationId?: string,
  ) {}
}
