import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InboundDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Product UUID' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001', description: 'Warehouse UUID' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: '100', description: 'Quantity as string (e.g., "100.000")' })
  @IsNumberString()
  @IsNotEmpty()
  quantity!: string;

  @ApiProperty({ example: 'Received from supplier ABC', description: 'Optional notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}