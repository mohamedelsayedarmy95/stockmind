import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFcmToken } from '../../domain/entities/user-fcm-token.entity';

@Injectable()
export class TokensRepository {
  constructor(
    @InjectRepository(UserFcmToken)
    private readonly repo: Repository<UserFcmToken>,
  ) {}

  async saveToken(userId: string, token: string, deviceType: 'android' | 'ios' = 'android'): Promise<void> {
    // Check if token already exists for this user
    const existing = await this.repo.findOne({ where: { userId, fcmToken: token } });
    if (!existing) {
      const userFcmToken = this.repo.create({ userId, fcmToken: token, deviceType });
      await this.repo.save(userFcmToken);
    }
  }

  async getTokenByUserId(userId: string): Promise<string | null> {
    const token = await this.repo.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    return token ? token.fcmToken : null;
  }

  async getUserTokens(userId: string): Promise<UserFcmToken[]> {
    return this.repo.find({ where: { userId } });
  }

  async removeToken(token: string): Promise<void> {
    await this.repo.delete({ fcmToken: token });
  }
}
