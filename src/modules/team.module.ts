import { Module } from '@nestjs/common';
import { TeamController } from '../presentation/controllers/team.controller';
import { TeamService } from '../infrastructure/repositories/team.service';
import { MembershipService } from '../infrastructure/repositories/membership.service';

@Module({
  controllers: [TeamController],
  providers: [TeamService, MembershipService],
  exports: [TeamService, MembershipService],
})
export class TeamModule {}
