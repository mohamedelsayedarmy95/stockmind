import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HuggingFaceService } from '../../infrastructure/ai/hugging-face.service';
import { AskDto } from '../../application/dtos/ai/ask.dto';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS } from '../../shared/constants/permissions.constant';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(PermissionsGuard)
export class AiController {
  constructor(private readonly hf: HuggingFaceService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.VIEW_PRODUCT)
  @ApiOperation({ summary: 'Ask AI assistant a question' })
  @ApiResponse({ status: 200, description: 'Returns AI-generated answer' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async ask(@Body() dto: AskDto): Promise<{ answer: string }> {
    const answer = await this.hf.askAssistant(dto.prompt, dto.language ?? 'en');
    return { answer };
  }

  @Get('reorder/:productId')
  @RequirePermissions(PERMISSIONS.VIEW_MOVEMENTS)
  @ApiOperation({ summary: 'Get AI-predicted reorder point for product' })
  @ApiResponse({ status: 200, description: 'Returns recommended reorder quantity' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async reorder(@Param('productId') productId: string) {
    return this.hf.predictReorder(productId);
  }
}