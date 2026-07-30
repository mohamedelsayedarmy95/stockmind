import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsArray,
  ValidateNested,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUomDto {
  @ApiProperty({ example: 'piece', description: 'Unit of measure type (e.g., piece, kg, liter)' })
  @IsString()
  @IsNotEmpty()
  uomType!: string;

  @ApiProperty({ example: 'PCS', description: 'Unit code (e.g., PCS, KG, L)' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiPropertyOptional({ example: '24', description: 'Conversion factor to base unit (optional)' })
  @IsNumberString()
  @IsOptional()
  conversionFactorToBase?: string;
}

export class CreateProductDto {
  @ApiProperty({ example: 'USB-C Cable', description: 'Product name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'PROD-A-001', description: 'Stock Keeping Unit (SKU)' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiPropertyOptional({ example: 'elec-001', description: 'Category ID (optional)' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ example: '8901234567890', description: 'Barcode (optional)' })
  @IsString()
  @IsOptional()
  barcode?: string;

  // Optional, encrypted at rest. Omitted by existing callers ⇒ no behaviour change.
  @ApiPropertyOptional({ example: '12.50', description: 'Cost price (encrypted at rest)', required: false })
  @IsNumberString()
  @IsOptional()
  costPrice?: string;

  @ApiPropertyOptional({ example: '0.05', description: 'Weight in kg (optional)', required: false })
  @IsNumberString()
  @IsOptional()
  weight?: string;

  @ApiPropertyOptional({ example: '0.001', description: 'Volume in m³ (optional)', required: false })
  @IsNumberString()
  @IsOptional()
  volume?: string;

  @ApiPropertyOptional({ example: '2025-12-31', description: 'Expiry date (ISO string, optional)', required: false })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @ApiPropertyOptional({ type: [CreateUomDto], description: 'Array of units of measure' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateUomDto)
  @IsOptional()
  unitsOfMeasure?: CreateUomDto[];
}