import { IsNotEmpty, IsNumberString, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustmentDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Product UUID' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001', description: 'Warehouse UUID' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: '10.5', description: 'Adjustment quantity (can be negative or positive)' })
  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @ApiProperty({ example: 'Cycle count adjustment', description: 'Reason for adjustment' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}