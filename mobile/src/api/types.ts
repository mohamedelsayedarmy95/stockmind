export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string };
}

export interface RegisterResponse extends LoginResponse {
  company: { id: string; name: string };
  defaultWarehouse: { id: string; name: string };
}

export interface UnitOfMeasure {
  id: string;
  uomType: string;
  code: string;
  conversionFactorToBase: string;
}

export interface Product {
  id: string;
  publicId?: string;
  name: string;
  sku: string;
  barcode?: string | null;
  imageUrl?: string | null;
  categoryId?: string | null;
  unitsOfMeasure?: UnitOfMeasure[];
}

export interface BalanceResponse {
  productId: string;
  warehouseId: string;
  baseQuantity: string;
}

export interface StockMovement {
  id: string;
  type: string;
  quantity: string;
  balanceAfter: string;
  notes?: string | null;
  createdAt: string;
}

export interface AskResponse {
  answer: string;
}
