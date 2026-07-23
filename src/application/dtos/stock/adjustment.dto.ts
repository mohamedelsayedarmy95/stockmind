import { IsNotEmpty, IsNumberString, IsString, IsUUID } from 'class-validator';

export class AdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
