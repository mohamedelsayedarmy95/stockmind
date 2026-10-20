import { Module } from '@nestjs/common';
import { TeamController } from '../presentation/controllers/team.controller';
import { TeamService } from '../infrastructure/repositories/team.service';

@Module({
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
