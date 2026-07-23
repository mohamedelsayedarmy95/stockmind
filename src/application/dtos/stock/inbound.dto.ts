import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';

export class InboundDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
