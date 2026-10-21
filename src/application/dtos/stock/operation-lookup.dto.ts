import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID, Matches, ValidateNested } from 'class-validator';

/** One operation the client wants re-checked: the Idempotency-Key it was sent with and, if known, its receipt. */
export class OperationRefDto {
  @Matches(/^[A-Za-z0-9_-]{8,128}$/)
  key!: string;

  /** Movement id from the client's receipt, if it got one. Lets the server find the movement without the key record. */
  @IsOptional()
  @IsUUID()
  movementId?: string;
}

export class LookupOperationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OperationRefDto)
  operations!: OperationRefDto[];
}
