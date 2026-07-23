import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class TransferDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fromWarehouseId!: string;

  @IsUUID()
  toWarehouseId!: string;

  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
