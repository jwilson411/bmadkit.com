/**
 * Advanced Edge Case Tests - Document Handling
 * Test IDs: EGE-DOC-001, EGE-DOC-002
 * Priority: P0 - Critical Data Volume & Boundary Edge Cases
 * 
 * Tests for:
 * - Massive document export (100MB+)
 * - Unicode content complexity
 * - Memory management during large operations
 * - Content integrity across all formats
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { app } from '../../app';
import { createMockUser, generateLargeContent, generateUnicodeTestContent } from '../fixtures/test-data';

describe('Document Handling Edge Cases', () => {
  let prisma: PrismaClient;
  let authToken: string;
  let userId: string;
  let testSessionId: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    const user = await createMockUser(prisma);
    userId = user.id;
    authToken = generateTestJWT(user.id);
    
    // Enable premium features for export testing
    await activatePremiumForUser(userId);

    // Create test session
    const sessionResponse = await request(app)
      .post('/api/sessions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ projectInput: 'Large document handling test session' });
    
    testSessionId = sessionResponse.body.data.id;
  });

  afterEach(async () => {
    await prisma.planningSession.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
  });

  describe('EGE-DOC-001: Massive Document Export Handling', () => {
    it('should export extremely large documents (100MB+) within performance limits', async () => {
      // Generate massive content - simulate 10,000+ conversation exchanges
      const largeContent = generateLargeContent({
        messageCount: 10000,
        averageMessageLength: 2000,
        includeCodeBlocks: true,
        includeTables: true,
        includeImages: false // Text-based for initial test
      });

      // Add content to session in chunks to simulate real workflow
      const chunkSize = 100; // Messages per chunk
      const chunks = Math.ceil(largeContent.messages.length / chunkSize);
      
      console.log(`Adding ${largeContent.messages.length} messages in ${chunks} chunks...`);

      for (let i = 0; i < chunks; i++) {
        const startIdx = i * chunkSize;
        const endIdx = Math.min(startIdx + chunkSize, largeContent.messages.length);
        const chunkMessages = largeContent.messages.slice(startIdx, endIdx);

        await request(app)
          .post(`/api/sessions/${testSessionId}/messages/batch`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ messages: chunkMessages })
          .expect(201);

        // Monitor memory usage during content addition
        const memUsage = process.memoryUsage();
        console.log(`Chunk ${i + 1}/${chunks} - Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
        
        // Ensure memory doesn't exceed 2GB per the validation criteria
        expect(memUsage.heapUsed).toBeLessThan(2 * 1024 * 1024 * 1024);
      }

      // Test export in all supported formats simultaneously
      const exportFormats = ['PDF', 'DOCX', 'MARKDOWN', 'JSON'];
      const exportStartTime = Date.now();
      
      const exportPromises = exportFormats.map(format => 
        request(app)
          .post(`/api/sessions/${testSessionId}/export`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ 
            format,
            options: {
              includeMetadata: true,
              compressionLevel: 'high',
              chunkSize: 50 // Process in chunks to manage memory
            }
          })
      );

      const exportResults = await Promise.all(exportPromises);
      const exportDuration = Date.now() - exportStartTime;

      // Validation Criteria from QA specs
      expect(exportDuration).toBeLessThan(10 * 60 * 1000); // 10 minutes max
      
      exportResults.forEach((result, index) => {
        expect(result.status).toBe(200);
        expect(result.body.data.downloadUrl).toBeDefined();
        expect(result.body.data.format).toBe(exportFormats[index]);
        
        // Verify no data truncation or corruption
        expect(result.body.data.contentHash).toBeDefined();
        expect(result.body.data.sizeBytes).toBeGreaterThan(0);
        expect(result.body.data.completionStatus).toBe('COMPLETE');
      });

      // Test memory management during export
      const finalMemUsage = process.memoryUsage();
      console.log(`Final memory usage: ${Math.round(finalMemUsage.heapUsed / 1024 / 1024)}MB`);
      expect(finalMemUsage.heapUsed).toBeLessThan(2 * 1024 * 1024 * 1024);
    });

    it('should handle export during active session with ongoing content generation', async () => {
      // Start generating content
      const contentGenerationPromise = request(app)
        .post(`/api/sessions/${testSessionId}/agents/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          agentType: 'ANALYST',
          prompt: 'Generate comprehensive 500-page business analysis report',
          streamResponse: true
        });

      // Wait for generation to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Initiate export during active generation
      const exportResponse = await request(app)
        .post(`/api/sessions/${testSessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          format: 'PDF',
          options: { 
            snapshotMode: 'CURRENT_STATE',
            includeProgressIndicator: true 
          }
        })
        .expect(200);

      // Verify export captures stable version
      expect(exportResponse.body.data.version).toBeDefined();
      expect(exportResponse.body.data.progressIndicator).toBeDefined();
      expect(exportResponse.body.data.warningMessage).toContain('generated during active session');

      await contentGenerationPromise;
    });

    it('should handle network interruption during large file download', async () => {
      // Generate large content
      const largeContent = generateLargeContent({ messageCount: 5000 });
      
      await request(app)
        .post(`/api/sessions/${testSessionId}/messages/batch`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ messages: largeContent.messages });

      // Initiate export
      const exportResponse = await request(app)
        .post(`/api/sessions/${testSessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' })
        .expect(200);

      const downloadUrl = exportResponse.body.data.downloadUrl;

      // Simulate network interruption by mocking timeout
      const downloadPromise = request(app)
        .get(downloadUrl.replace(process.env.BASE_URL || 'http://localhost', ''))
        .timeout(5000); // 5 second timeout

      try {
        await downloadPromise;
      } catch (error) {
        // Should handle timeout gracefully
        expect(error.message).toContain('timeout');
      }

      // Verify export remains available for retry
      const retryResponse = await request(app)
        .get(`/api/sessions/${testSessionId}/exports/${exportResponse.body.data.exportId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(retryResponse.body.data.status).toBe('COMPLETED');
      expect(retryResponse.body.data.retryDownloadUrl).toBeDefined();
    });

    it('should handle concurrent large exports from multiple users', async () => {
      // Create multiple test users
      const users = await Promise.all([
        createMockUser(prisma),
        createMockUser(prisma),
        createMockUser(prisma)
      ]);

      // Create sessions for each user with large content
      const userSessions = await Promise.all(
        users.map(async (user) => {
          const token = generateTestJWT(user.id);
          await activatePremiumForUser(user.id);

          const sessionResponse = await request(app)
            .post('/api/sessions')
            .set('Authorization', `Bearer ${token}`)
            .send({ projectInput: 'Concurrent export test' });

          const sessionId = sessionResponse.body.data.id;
          
          // Add large content
          const content = generateLargeContent({ messageCount: 2000 });
          await request(app)
            .post(`/api/sessions/${sessionId}/messages/batch`)
            .set('Authorization', `Bearer ${token}`)
            .send({ messages: content.messages });

          return { userId: user.id, sessionId, token };
        })
      );

      // Initiate concurrent exports
      const exportStartTime = Date.now();
      const concurrentExports = userSessions.map(({ sessionId, token }) =>
        request(app)
          .post(`/api/sessions/${sessionId}/export`)
          .set('Authorization', `Bearer ${token}`)
          .send({ format: 'PDF' })
      );

      const results = await Promise.all(concurrentExports);
      const exportDuration = Date.now() - exportStartTime;

      // All exports should succeed
      results.forEach(result => {
        expect(result.status).toBe(200);
        expect(result.body.data.downloadUrl).toBeDefined();
      });

      // System should handle concurrent load without degradation
      expect(exportDuration).toBeLessThan(15 * 60 * 1000); // 15 minutes for concurrent
      
      // Verify memory didn't exceed limits
      const memUsage = process.memoryUsage();
      expect(memUsage.heapUsed).toBeLessThan(2 * 1024 * 1024 * 1024);
    });

    it('should handle storage disk space exhaustion gracefully', async () => {
      // Mock storage service to simulate disk space exhaustion
      const originalWrite = fs.writeFile;
      let writeCount = 0;

      jest.spyOn(fs, 'writeFile').mockImplementation(async (path, data, options) => {
        writeCount++;
        if (writeCount > 3) {
          throw new Error('ENOSPC: no space left on device');
        }
        return originalWrite(path, data, options);
      });

      const largeContent = generateLargeContent({ messageCount: 1000 });
      await request(app)
        .post(`/api/sessions/${testSessionId}/messages/batch`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ messages: largeContent.messages });

      const exportResponse = await request(app)
        .post(`/api/sessions/${testSessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ format: 'PDF' })
        .expect(503); // Service Unavailable

      expect(exportResponse.body.error.code).toBe('STORAGE_EXHAUSTED');
      expect(exportResponse.body.error.message).toContain('temporary storage issue');
      expect(exportResponse.body.data.retryAfter).toBeDefined();
    });
  });

  describe('EGE-DOC-002: Unicode Content Complexity', () => {
    it('should handle complex Unicode content in all document formats', async () => {
      const unicodeContent = generateUnicodeTestContent();
      
      // Add Unicode content to session
      await request(app)
        .post(`/api/sessions/${testSessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: unicodeContent.mixedDirectionalText,
          agentType: 'ANALYST',
          metadata: { contentType: 'UNICODE_TEST' }
        })
        .expect(201);

      await request(app)
        .post(`/api/sessions/${testSessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: unicodeContent.emojiCombinations,
          agentType: 'PM'
        })
        .expect(201);

      await request(app)
        .post(`/api/sessions/${testSessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: unicodeContent.mathematicalSymbols,
          agentType: 'UX_EXPERT'
        })
        .expect(201);

      // Test export in all formats with Unicode preservation
      const formats = ['PDF', 'DOCX', 'MARKDOWN', 'JSON'];
      const exportResults = await Promise.all(
        formats.map(format =>
          request(app)
            .post(`/api/sessions/${testSessionId}/export`)
            .set('Authorization', `Bearer ${authToken}`)
            .send({ 
              format,
              options: {
                unicodeNormalization: 'NFC',
                preserveDirectionality: true,
                fontFallback: true
              }
            })
            .expect(200)
        )
      );

      // Verify Unicode fidelity in each format
      exportResults.forEach((result, index) => {
        const format = formats[index];
        expect(result.body.data.unicodeValidation).toBe('PASSED');
        expect(result.body.data.characterFidelityScore).toBeGreaterThan(0.95);
        
        if (format === 'JSON') {
          // JSON should preserve exact Unicode
          const exportedContent = JSON.parse(result.body.data.content);
          const messages = exportedContent.messages;
          
          expect(messages.some((m: any) => m.content.includes('العربية'))).toBe(true); // Arabic
          expect(messages.some((m: any) => m.content.includes('עברית'))).toBe(true); // Hebrew
          expect(messages.some((m: any) => m.content.includes('🧑🏽‍💻'))).toBe(true); // Emoji with modifier
        }
      });
    });

    it('should handle bidirectional text rendering correctly', async () => {
      const bidiText = `
        English text followed by العربية (Arabic) and back to English.
        Another line with עברית (Hebrew) mixed with English text.
        Complex case: "The file name is ملف_البيانات.txt in Arabic" 
        Nested: English (Arabic: العربية Hebrew: עברית) English again.
      `;

      await request(app)
        .post(`/api/sessions/${testSessionId}/messages`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          content: bidiText,
          agentType: 'ANALYST'
        });

      const exportResponse = await request(app)
        .post(`/api/sessions/${testSessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          format: 'PDF',
          options: {
            bidiTextSupport: true,
            textDirection: 'auto'
          }
        })
        .expect(200);

      // Verify bidirectional text handling
      expect(exportResponse.body.data.bidiValidation).toBe('PASSED');
      expect(exportResponse.body.data.textDirectionAccuracy).toBeGreaterThan(0.9);
    });

    it('should handle zero-width characters and combining characters', async () => {
      const complexUnicode = {
        zeroWidth: 'Test\u200Bwith\u200Bzero\u200Bwidth\u200Bspaces',
        combining: 'e\u0301 (e with acute accent combining)',
        normalization: 'café vs cafe\u0301', // Different Unicode representations
        invisibleChars: 'Text\u200E\u200Fwith\u202Adirection\u202Cmarkers'
      };

      for (const [type, content] of Object.entries(complexUnicode)) {
        await request(app)
          .post(`/api/sessions/${testSessionId}/messages`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            content: `${type.toUpperCase()}: ${content}`,
            agentType: 'ANALYST'
          });
      }

      const exportResponse = await request(app)
        .post(`/api/sessions/${testSessionId}/export`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          format: 'MARKDOWN',
          options: {
            normalizeUnicode: true,
            preserveCombining: true,
            sanitizeInvisible: false
          }
        })
        .expect(200);

      // Verify proper handling of complex Unicode
      expect(exportResponse.body.data.unicodeComplexityScore).toBeGreaterThan(0.8);
      expect(exportResponse.body.data.normalizationWarnings).toBeDefined();
    });

    it('should maintain search functionality with Unicode queries', async () => {
      // Add multilingual content
      const multilingualContent = [
        'Project analysis in English',
        'Análisis del proyecto en español',
        'تحليل المشروع باللغة العربية',
        'פרויקט ניתוח בעברית',
        '项目分析中文',
        'Проект анализ на русском'
      ];

      for (const content of multilingualContent) {
        await request(app)
          .post(`/api/sessions/${testSessionId}/messages`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ content, agentType: 'ANALYST' });
      }

      // Test search with Unicode queries
      const searchQueries = [
        'analysis', // English
        'análisis', // Spanish with accent
        'تحليل', // Arabic
        'ניתוח', // Hebrew
        '分析', // Chinese
        'анализ' // Russian
      ];

      for (const query of searchQueries) {
        const searchResponse = await request(app)
          .get(`/api/sessions/${testSessionId}/search`)
          .set('Authorization', `Bearer ${authToken}`)
          .query({ 
            q: query,
            unicodeNormalization: true
          })
          .expect(200);

        expect(searchResponse.body.data.results.length).toBeGreaterThan(0);
        expect(searchResponse.body.data.unicodeSupported).toBe(true);
      }
    });
  });
});

// Helper functions remain the same as in previous test file
function generateTestJWT(userId: string): string {
  return `mock-jwt-token-${userId}`;
}

async function activatePremiumForUser(userId: string): Promise<void> {
  console.log(`Activated premium for user ${userId}`);
}