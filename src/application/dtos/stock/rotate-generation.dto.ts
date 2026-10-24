import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

export const ROTATE_CONFIRMATION = 'ROTATE_HISTORY_GENERATION';

export class RotateGenerationDto {
  /** Why: who restored what, from which restore point, and the incident id. Stored in the append-only event. */
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  reason!: string;

  /** Typed literally, so a rotation is never sent by accident or by a script that only knows the URL. */
  @IsString()
  @Equals(ROTATE_CONFIRMATION)
  confirm!: string;
}
