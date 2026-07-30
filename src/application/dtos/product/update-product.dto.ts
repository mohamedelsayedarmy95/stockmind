import { IsOptional, IsString, IsDateString, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProductDto {
  @ApiProperty({ example: 'Updated Product Name', description: 'Product name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'SKU-UPDATED', description: 'Stock Keeping Unit', required: false })
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiProperty({ example: 'cat_123', description: 'Category ID', required: false })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ example: '1234567890123', description: 'Barcode', required: false })
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiProperty({ example: '2.5', description: 'Weight in kg', required: false })
  @IsNumberString()
  @IsOptional()
  weight?: string;

  @ApiProperty({ example: '0.5', description: 'Volume in cubic meters', required: false })
  @IsNumberString()
  @IsOptional()
  volume?: string;

  @ApiProperty({ example: '2025-12-31', description: 'Expiry date (ISO 8601)', required: false })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}