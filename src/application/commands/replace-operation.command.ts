import { ReplaceOperationDto } from '../dtos/stock/replace-operation.dto';
import { ReplacementKind } from '../../infrastructure/repositories/stock-replacement.service';

export class ReplaceOperationCommand {
  constructor(
    public readonly userId: string,
    public readonly companyId: string,
    public readonly kind: ReplacementKind,
    public readonly replacementKey: string,
    public readonly dto: ReplaceOperationDto,
    public readonly correlationId?: string,
  ) {}
}
