import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { HuggingFaceService } from '../../infrastructure/ai/hugging-face.service';
import { AskDto } from '../../application/dtos/ai/ask.dto';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

@Controller('ai')
@UseGuards(PermissionsGuard)
export class AiController {
  constructor(private readonly hf: HuggingFaceService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  async ask(@Body() dto: AskDto): Promise<{ answer: string }> {
    const answer = await this.hf.askAssistant(dto.prompt, dto.language ?? 'en');
    return { answer };
  }

  @Get('reorder/:productId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  async reorder(@Param('productId') productId: string) {
    return this.hf.predictReorder(productId);
  }
}
