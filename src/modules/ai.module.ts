import { Global, Module } from '@nestjs/common';
import { HuggingFaceService } from '../infrastructure/ai/hugging-face.service';
import { AiController } from '../presentation/controllers/ai.controller';

@Global()
@Module({
  controllers: [AiController],
  providers: [HuggingFaceService],
  exports: [HuggingFaceService],
})
export class AiModule {}
