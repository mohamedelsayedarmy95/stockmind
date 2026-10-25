import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** CP-4: who gets access to the new warehouse, decided at creation. Absent = nobody (never an automatic grant). */
export class InitialAccessDto {
  @IsUUID('all')
  userId!: string;

  @IsString()
  @MaxLength(64)
  profile!: string;
}

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InitialAccessDto)
  initialAccess?: InitialAccessDto[];
}
