import { IsOptional, IsString, IsDateString, IsNumberString } from 'class-validator';

export class UpdateProductDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsNumberString()
  @IsOptional()
  weight?: string;

  @IsNumberString()
  @IsOptional()
  volume?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}
