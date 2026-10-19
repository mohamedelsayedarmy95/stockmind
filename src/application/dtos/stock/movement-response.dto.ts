import { StockMovement } from '../../../domain/entities/stock-movement.entity';
import { MovementType, ReferenceType } from '../../../shared/constants/enums';

/**
 * Public shape of a stock movement in API responses.
 *
 * Explicit allowlist: the related User and Warehouse are reduced to {id, name},
 * so credential columns (passwordHash, refreshTokenHash) and private contact data
 * can never be serialized, whatever those entities gain later.
 */
export interface MovementResponseDto {
  id: string;
  productId: string;
  warehouseId: string;
  userId: string;
  movementType: MovementType;
  referenceType: ReferenceType;
  referenceId: string | null;
  quantityChange: string;
  runningBalance: string;
  notes: string | null;
  createdAt: Date;
  warehouse: { id: string; name: string } | null;
  user: { id: string; name: string } | null;
}

export function toMovementResponse(movement: StockMovement): MovementResponseDto {
  return {
    id: movement.id,
    productId: movement.productId,
    warehouseId: movement.warehouseId,
    userId: movement.userId,
    movementType: movement.movementType,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    quantityChange: movement.quantityChange,
    runningBalance: movement.runningBalance,
    notes: movement.notes,
    createdAt: movement.createdAt,
    warehouse: movement.warehouse ? { id: movement.warehouse.id, name: movement.warehouse.name } : null,
    user: movement.user ? { id: movement.user.id, name: movement.user.name } : null,
  };
}
