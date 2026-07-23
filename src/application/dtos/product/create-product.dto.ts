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

export class CreateUomDto {
  @IsString()
  @IsNotEmpty()
  uomType!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsNumberString()
  @IsOptional()
  conversionFactorToBase?: string;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  // Optional, encrypted at rest. Omitted by existing callers ⇒ no behaviour change.
  @IsNumberString()
  @IsOptional()
  costPrice?: string;

  @IsNumberString()
  @IsOptional()
  weight?: string;

  @IsNumberString()
  @IsOptional()
  volume?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateUomDto)
  @IsOptional()
  unitsOfMeasure?: CreateUomDto[];
}
