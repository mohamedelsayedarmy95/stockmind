import { Equals, IsBoolean, IsISO8601, IsNumberString, IsOptional, IsUUID, Matches } from 'class-validator';

/**
 * A person's decision to replace an operation that the server's current history no longer holds. Everything here is the
 * client's CLAIM about the original (the server cannot verify an operation it does not have); the server decides on its
 * own evidence (key records, ledger, generation, access) and records these claims next to its decision.
 */
export class ReplaceOperationDto {
  /** The Idempotency-Key the original operation was sent with (same key space: the caller's own). */
  @Matches(/^[A-Za-z0-9_-]{8,128}$/)
  originalKey!: string;

  /** Movement id from the original receipt: required evidence that the operation was once confirmed. */
  @IsUUID()
  originalMovementId!: string;

  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  /** Same quantity as the original: a replacement restores that operation, it is not a way to enter another one. */
  @IsNumberString()
  quantity!: string;

  /** The history generation the user reviewed the situation in. A different current generation refuses the request. */
  @IsUUID()
  expectedGeneration!: string;

  /** The person confirmed, after being told the original is absent from the current history and may not have been undone. */
  @IsBoolean()
  @Equals(true)
  acknowledge!: boolean;

  @IsOptional()
  @Matches(/^\d{1,18}$/)
  receiptRevision?: string;

  @IsOptional()
  @IsISO8601()
  receiptConfirmedAt?: string;

  @IsOptional()
  @IsUUID()
  receiptGeneration?: string;
}
