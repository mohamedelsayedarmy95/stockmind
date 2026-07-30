import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFcmToken } from '../../domain/entities/user-fcm-token.entity';

@Injectable()
export class FcmTokenRepository {
  constructor(
    @InjectRepository(UserFcmToken)
    private readonly repository: Repository<UserFcmToken>,
  ) {}

  async saveToken(userId: string, fcmToken: string, deviceType: 'android' | 'ios'): Promise<UserFcmToken> {
    // Check if token already exists for another user (should be unique across users)
    const existing = await this.repository.findOne({ where: { fcmToken } });
    if (existing && existing.userId !== userId) {
      // Token is already used by another user, remove it from the old user
      await this.repository.remove(existing);
    }

    // Check if the user already has this token
    const userToken = await this.repository.findOne({
      where: { userId, fcmToken },
    });

    if (userToken) {
      // Update the device type if changed
      if (userToken.deviceType !== deviceType) {
        userToken.deviceType = deviceType;
        return await this.repository.save(userToken);
      }
      return userToken;
    }

    const token = this.repository.create({
      userId,
      fcmToken,
      deviceType,
    });

    return await this.repository.save(token);
  }

  async removeToken(fcmToken: string): Promise<void> {
    await this.repository.delete({ fcmToken });
  }

  async getUserTokens(userId: string): Promise<UserFcmToken[]> {
    return await this.repository.find({
      where: { userId },
    });
  }

  async removeUserTokens(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }
}