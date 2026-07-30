// fcm.service.spec.ts
import { FcmService } from '../../src/infrastructure/firebase/fcm.service';
import { TokensRepository } from '../../src/infrastructure/repositories/tokens.repository';

// Mock the firebase-admin module (the local file)
jest.mock('../../src/infrastructure/firebase/firebase-admin');

describe('FcmService', () => {
  let service: FcmService;
  let tokensRepository: {
    getUserTokens: jest.Mock;
    saveToken: jest.Mock;
    removeToken: jest.Mock;
  };
  let firebaseAdminMock: any;
  let mockSendEachForMulticast: jest.Mock;
  let mockSend: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create fresh mocks for the repository methods
    tokensRepository = {
      getUserTokens: jest.fn(),
      saveToken: jest.fn(),
      removeToken: jest.fn(),
    };

    // Create the service with the mock repository
    service = new FcmService(tokensRepository as unknown as TokensRepository);

    // Get the mocked firebase-admin module
    firebaseAdminMock = require('../../src/infrastructure/firebase/firebase-admin');

    // Set up the mocked messaging object
    const messaging = {
      sendEachForMulticast: jest.fn(),
      send: jest.fn(),
    };
    firebaseAdminMock.getMessaging.mockReturnValue(messaging);
    // Default: Firebase is configured
    firebaseAdminMock.isFirebaseConfigured.mockReturnValue(true);

    // Assign mocks for easy access in tests
    mockSendEachForMulticast = messaging.sendEachForMulticast;
    mockSend = messaging.send;
  });

  const userId = 'user-1';
  const title = 'Test Title';
  const body = 'Test Body';

  describe('sendToDevice', () => {
    it('should do nothing if Firebase is not configured', async () => {
      firebaseAdminMock.isFirebaseConfigured.mockReturnValue(false);

      await service.sendToDevice(userId, title, body);

      expect(tokensRepository.getUserTokens).not.toHaveBeenCalled();
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should do nothing if no tokens found for user', async () => {
      tokensRepository.getUserTokens.mockResolvedValue([]);

      await service.sendToDevice(userId, title, body);

      expect(tokensRepository.getUserTokens).toHaveBeenCalledWith(userId);
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should send notification and handle success', async () => {
      const mockTokens = [
        { fcmToken: 'token1', deviceType: 'android' },
        { fcmToken: 'token2', deviceType: 'ios' },
      ];
      tokensRepository.getUserTokens.mockResolvedValue(mockTokens);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 2,
        failureCount: 0,
        responses: [{ success: true }, { success: true }],
      });

      await service.sendToDevice(userId, title, body, { key: 'value' });

      expect(tokensRepository.getUserTokens).toHaveBeenCalledWith(userId);
      expect(mockSendEachForMulticast).toHaveBeenCalledWith({
        notification: { title, body },
        data: { key: 'value' },
        tokens: ['token1', 'token2'],
      });
    });

    it('should remove invalid tokens after sending', async () => {
      const mockTokens = [
        { fcmToken: 'token1', deviceType: 'android' },
        { fcmToken: 'token2', deviceType: 'ios' },
      ];
      tokensRepository.getUserTokens.mockResolvedValue(mockTokens);
      mockSendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true },
          {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
              message: 'Unregistered',
            },
          },
        ],
      });

      await service.sendToDevice(userId, title, body);

      expect(tokensRepository.removeToken).toHaveBeenCalledWith('token2');
    });

    it('should retry on failure up to 3 times', async () => {
      const mockTokens = [{ fcmToken: 'token1', deviceType: 'android' }];
      tokensRepository.getUserTokens.mockResolvedValue(mockTokens);
      mockSendEachForMulticast
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue({ successCount: 1, failureCount: 0, responses: [{ success: true }] });

      await service.sendToDevice(userId, title, body);

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendNotification', () => {
    it('should send a notification to a single token', async () => {
      const token = 'device-token';
      const payload = { notification: { title: 'Test', body: 'Body' } };

      mockSend.mockResolvedValueOnce({ messageId: 'msg-id' });

      await service.sendNotification(token, payload);

      expect(mockSend).toHaveBeenCalledWith({
        token: 'device-token',
        notification: { title: 'Test', body: 'Body' },
      });
    });

    it('should do nothing if Firebase not configured', async () => {
      firebaseAdminMock.isFirebaseConfigured.mockReturnValue(false);

      await service.sendNotification('token', {});

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('sendStockNotification', () => {
    it('should call sendToDevice with correct parameters', async () => {
      const sendToDeviceSpy = jest.spyOn(service, 'sendToDevice');

      await service.sendStockNotification('user-1', 'STOCK_RECEIVED', 'product-1', 100);

      expect(sendToDeviceSpy).toHaveBeenCalledWith(
        'user-1',
        'Stock STOCK_RECEIVED',
        'Product product-1: 100 units stock_received',
        { action: 'STOCK_RECEIVED', productId: 'product-1', quantity: '100' }
      );
    });
  });
});