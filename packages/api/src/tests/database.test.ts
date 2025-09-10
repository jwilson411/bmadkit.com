import { getConfig } from '../utils/config';

jest.mock('../utils/config');

describe('Database Configuration', () => {
  const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Database URL Configuration', () => {
    it('should handle missing DATABASE_URL', () => {
      mockGetConfig.mockReturnValue({
        NODE_ENV: 'test',
        PORT: 3001,
        LOG_LEVEL: 'info',
      } as any);

      expect(() => {
        const { getPrismaClient } = require('../utils/database');
        getPrismaClient();
      }).toThrow('DATABASE_URL is required but not provided in environment configuration');
    });

    it('should handle valid DATABASE_URL', () => {
      mockGetConfig.mockReturnValue({
        NODE_ENV: 'test',
        PORT: 3001,
        LOG_LEVEL: 'info',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/bmad_test',
      } as any);

      expect(() => {
        const { getPrismaClient } = require('../utils/database');
        getPrismaClient();
      }).not.toThrow();
    });
  });

  describe('Database Utilities Export', () => {
    it('should export all required database utilities', () => {
      const databaseUtils = require('../utils/database');
      
      expect(databaseUtils.getPrismaClient).toBeDefined();
      expect(databaseUtils.connectDatabase).toBeDefined();
      expect(databaseUtils.disconnectDatabase).toBeDefined();
      expect(databaseUtils.testDatabaseConnection).toBeDefined();
    });
  });
});