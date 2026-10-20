// notification.flow.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { EventBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InboundStockHandler } from '../../src/application/commands/inbound-stock.handler';
import { InboundStockCommand } from '../../src/application/commands/inbound-stock.command';
import { StockService } from '../../src/infrastructure/repositories/stock.service';
import { FcmService } from '../../src/infrastructure/firebase/fcm.service';
import { TokensRepository } from '../../src/infrastructure/repositories/tokens.repository';

describe('Notification Flow Integration', () => {
  let inboundStockHandler: InboundStockHandler;
  let stockService: StockService;
  let fcmService: FcmService;
  let tokensRepository: TokensRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundStockHandler,
        {
          provide: StockService,
          useValue: {
            inbound: jest.fn(),
          },
        },
        {
          provide: FcmService,
          useValue: {
            // The handler chains .catch() on this call, so the mock must return a Promise like the real method.
            sendStockNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        // The handler also emits the domain event that the audit listeners consume.
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: EventBus, useValue: { publish: jest.fn() } },
        {
          provide: TokensRepository,
          useValue: {
            getUserTokens: jest.fn(),
            removeToken: jest.fn(),
            saveToken: jest.fn(),
          },
        },
      ],
    }).compile();

    inboundStockHandler = module.get<InboundStockHandler>(InboundStockHandler);
    // Cast to any to access mock methods
    stockService = module.get<StockService>(StockService) as any;
    fcmService = module.get<FcmService>(FcmService);
    tokensRepository = module.get<TokensRepository>(TokensRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should send a notification after successful inbound stock operation', async () => {
    const userId = 'user-1';
    const companyId = 'company-1';
    const dto = {
      productId: 'product-1',
      warehouseId: 'warehouse-1',
      quantity: '100',
    };
    const correlationId = 'corr-1';

    const stockResult = { runningBalance: '150.000000' };
    (stockService.inbound as jest.Mock).mockResolvedValue(stockResult);

    // Mock Firebase configuration to be true
    jest.spyOn(require('../../src/infrastructure/firebase/firebase-admin'), 'isFirebaseConfigured').mockReturnValue(true);

    // Mock tokens repository to return a token for the user
    (tokensRepository.getUserTokens as jest.Mock).mockResolvedValue([
      { fcmToken: 'token-123', deviceType: 'android' },
    ]);

    const command = new InboundStockCommand(userId, companyId, dto, correlationId);

    const result = await inboundStockHandler.execute(command);

    expect(stockService.inbound).toHaveBeenCalledWith(userId, companyId, dto);
    expect(fcmService.sendStockNotification).toHaveBeenCalledWith(
      userId,
      'STOCK_RECEIVED',
      dto.productId,
      parseFloat(dto.quantity),
    );
    expect(result).toEqual(stockResult);
  });

  it('should not send notification if stock operation fails', async () => {
    const userId = 'user-1';
    const companyId = 'company-1';
    const dto = {
      productId: 'product-1',
      warehouseId: 'warehouse-1',
      quantity: '100',
    };

    (stockService.inbound as jest.Mock).mockRejectedValue(new Error('Insufficient stock'));

    const command = new InboundStockCommand(userId, companyId, dto);

    await expect(inboundStockHandler.execute(command)).rejects.toThrow('Insufficient stock');

    expect(stockService.inbound).toHaveBeenCalledWith(userId, companyId, dto);
    expect(fcmService.sendStockNotification).not.toHaveBeenCalled();
  });
});