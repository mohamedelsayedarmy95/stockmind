// tokens.repository.spec.ts
import { TokensRepository } from '../../src/infrastructure/repositories/tokens.repository';
import { UserFcmToken } from '../../src/domain/entities/user-fcm-token.entity';
import { Repository } from 'typeorm';

describe('TokensRepository', () => {
  let repository: TokensRepository;
  let userFcmTokenRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(() => {
    // Create a mock repository for UserFcmToken
    userFcmTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      find: jest.fn(),
    };

    // Create the tokensRepository with the mock
    repository = new TokensRepository(userFcmTokenRepository as unknown as Repository<UserFcmToken>);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('saveToken', () => {
    const userId = 'user-1';
    const token = 'fcm-token-123';
    const deviceType = 'android';

    it('should save a new token if not exists for user', async () => {
      // Mock: no existing token for this user
      userFcmTokenRepository.findOne.mockResolvedValue(null);
      userFcmTokenRepository.create.mockReturnValue({});
      userFcmTokenRepository.save.mockResolvedValue(undefined);

      await repository.saveToken(userId, token, deviceType);

      expect(userFcmTokenRepository.findOne).toHaveBeenCalledWith({
        where: { userId, fcmToken: token },
      });
      expect(userFcmTokenRepository.create).toHaveBeenCalledWith({
        userId,
        fcmToken: token,
        deviceType,
      });
      expect(userFcmTokenRepository.save).toHaveBeenCalled();
    });

    it('should not save if token already exists for user', async () => {
      // Mock: token exists for user
      userFcmTokenRepository.findOne.mockResolvedValue({ userId, fcmToken: token, deviceType });

      await repository.saveToken(userId, token, deviceType);

      expect(userFcmTokenRepository.findOne).toHaveBeenCalledWith({
        where: { userId, fcmToken: token },
      });
      expect(userFcmTokenRepository.create).not.toHaveBeenCalled();
      expect(userFcmTokenRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getTokenByUserId', () => {
    const userId = 'user-1';

    it('should return the most recent token for user', async () => {
      const mockToken = { fcmToken: 'token-latest' };
      userFcmTokenRepository.findOne.mockResolvedValue(mockToken);

      const result = await repository.getTokenByUserId(userId);

      expect(userFcmTokenRepository.findOne).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe('token-latest');
    });

    it('should return null if no tokens found', async () => {
      userFcmTokenRepository.findOne.mockResolvedValue(null);

      const result = await repository.getTokenByUserId('user-2');

      expect(result).toBeNull();
    });
  });

  describe('getUserTokens', () => {
    const userId = 'user-1';

    it('should return all tokens for user', async () => {
      const mockTokens = [
        { id: '1', userId, fcmToken: 'token1', deviceType: 'android' },
        { id: '2', userId, fcmToken: 'token2', deviceType: 'ios' },
      ];
      userFcmTokenRepository.find.mockResolvedValue(mockTokens);

      const result = await repository.getUserTokens(userId);

      expect(userFcmTokenRepository.find).toHaveBeenCalledWith({
        where: { userId },
      });
      expect(result).toEqual(mockTokens);
    });
  });

  describe('removeToken', () => {
    const token = 'fcm-token-123';

    it('should delete token by fcmToken', async () => {
      await repository.removeToken(token);

      expect(userFcmTokenRepository.delete).toHaveBeenCalledWith({ fcmToken: token });
    });
  });
});