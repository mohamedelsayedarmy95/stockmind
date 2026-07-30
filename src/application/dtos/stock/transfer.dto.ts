import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Product UUID' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001', description: 'Source warehouse UUID' })
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440002', description: 'Destination warehouse UUID' })
  @IsUUID()
  toWarehouseId!: string;

  @ApiProperty({ example: '25', description: 'Quantity to transfer' })
  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @ApiProperty({ example: 'Transfer from NY to LA warehouse', description: 'Optional notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}