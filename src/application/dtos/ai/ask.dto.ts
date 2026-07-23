import { IsString, IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';

export class AskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt!: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: 'ar' | 'en';
}
