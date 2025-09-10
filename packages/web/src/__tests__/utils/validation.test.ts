import { describe, it, expect } from 'vitest';
import {
  validateProjectInput,
  getCharacterCount,
  getWordCount,
  assessInputQuality,
  validateSessionId,
  validateWebSocketUrl,
  sanitizeInput,
  truncateText,
} from '@/utils/validation';

describe('Validation Utils', () => {
  describe('validateProjectInput', () => {
    it('validates minimum length', () => {
      const result = validateProjectInput('Short');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Please describe your project idea in at least 10 characters');
    });

    it('validates maximum length', () => {
      const longText = 'a'.repeat(2001);
      const result = validateProjectInput(longText);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Project description must be less than 2000 characters');
    });

    it('validates empty input', () => {
      const result = validateProjectInput('   ');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Project description cannot be empty');
    });

    it('validates word count', () => {
      const result = validateProjectInput('One two');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Please provide more details about your project');
    });

    it('validates valid input', () => {
      const result = validateProjectInput('I want to build a mobile app for task management');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('provides warnings for short but valid input', () => {
      const result = validateProjectInput('I want to build an app');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Consider adding more details for better analysis');
    });

    it('suggests describing goals', () => {
      const result = validateProjectInput('This is a long enough description that passes the minimum requirements for validation testing purposes and should not trigger any errors');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Describing your goals or challenges will help our AI experts');
    });
  });

  describe('getCharacterCount', () => {
    it('returns correct character count info', () => {
      const result = getCharacterCount('Hello world');
      expect(result.current).toBe(11);
      expect(result.max).toBe(2000);
      expect(result.remaining).toBe(1989);
      expect(result.percentage).toBe(0.55);
    });

    it('handles empty string', () => {
      const result = getCharacterCount('');
      expect(result.current).toBe(0);
      expect(result.remaining).toBe(2000);
      expect(result.percentage).toBe(0);
    });

    it('handles maximum length', () => {
      const maxText = 'a'.repeat(2000);
      const result = getCharacterCount(maxText);
      expect(result.current).toBe(2000);
      expect(result.remaining).toBe(0);
      expect(result.percentage).toBe(100);
    });
  });

  describe('getWordCount', () => {
    it('counts words correctly', () => {
      expect(getWordCount('Hello world')).toBe(2);
      expect(getWordCount('I want to build an app')).toBe(6);
      expect(getWordCount('   spaced   out   words   ')).toBe(3);
    });

    it('handles empty string', () => {
      expect(getWordCount('')).toBe(0);
      expect(getWordCount('   ')).toBe(0);
    });

    it('handles single word', () => {
      expect(getWordCount('Hello')).toBe(1);
    });
  });

  describe('assessInputQuality', () => {
    it('assesses good quality input', () => {
      const input = 'I want to build a mobile app that helps users manage their tasks and goals. The budget is limited and we need it done within 3 months. What features should we prioritize?';
      const result = assessInputQuality(input);
      
      expect(result.quality).toBe('good');
      expect(result.score).toBeGreaterThanOrEqual(60);
    });

    it('assesses fair quality input', () => {
      const input = 'I want to build a mobile app for task management with basic features';
      const result = assessInputQuality(input);
      
      expect(result.quality).toBe('fair');
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.score).toBeLessThan(60);
    });

    it('assesses poor quality input', () => {
      const input = 'Build app';
      const result = assessInputQuality(input);
      
      expect(result.quality).toBe('needs-improvement');
      expect(result.score).toBeLessThan(30);
      expect(result.feedback.length).toBeGreaterThan(0);
    });

    it('provides appropriate feedback', () => {
      const input = 'Short description';
      const result = assessInputQuality(input);
      
      expect(result.feedback).toContain('Consider adding more details about your project');
      expect(result.feedback).toContain('Describe what you want to achieve');
    });

    it('recognizes technical terms', () => {
      const input = 'I need to build a web application with API integration and database management for my business requirements';
      const result = assessInputQuality(input);
      
      expect(result.score).toBeGreaterThan(20); // Should get points for technical terms
    });
  });

  describe('validateSessionId', () => {
    it('validates correct UUID format', () => {
      expect(validateSessionId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(validateSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('rejects invalid UUID format', () => {
      expect(validateSessionId('invalid-id')).toBe(false);
      expect(validateSessionId('123-456-789')).toBe(false);
      expect(validateSessionId('')).toBe(false);
      expect(validateSessionId('123e4567-e89b-12d3-a456-42661417400g')).toBe(false);
    });
  });

  describe('validateWebSocketUrl', () => {
    it('validates WebSocket URLs', () => {
      expect(validateWebSocketUrl('ws://localhost:3002')).toBe(true);
      expect(validateWebSocketUrl('wss://api.example.com/socket')).toBe(true);
    });

    it('rejects non-WebSocket URLs', () => {
      expect(validateWebSocketUrl('http://example.com')).toBe(false);
      expect(validateWebSocketUrl('https://example.com')).toBe(false);
      expect(validateWebSocketUrl('invalid-url')).toBe(false);
      expect(validateWebSocketUrl('')).toBe(false);
    });
  });

  describe('sanitizeInput', () => {
    it('removes HTML tags', () => {
      expect(sanitizeInput('Hello <script>alert("xss")</script> world')).toBe('Hello alert("xss") world');
      expect(sanitizeInput('Text with <div>tags</div>')).toBe('Text with tags');
    });

    it('removes javascript: URLs', () => {
      expect(sanitizeInput('Click javascript:alert("xss") here')).toBe('Click  here');
    });

    it('trims whitespace', () => {
      expect(sanitizeInput('  Hello world  ')).toBe('Hello world');
    });

    it('handles empty/null input', () => {
      expect(sanitizeInput('')).toBe('');
      expect(sanitizeInput('   ')).toBe('');
    });

    it('preserves safe content', () => {
      const safeText = 'I want to build a mobile app for task management';
      expect(sanitizeInput(safeText)).toBe(safeText);
    });
  });

  describe('truncateText', () => {
    it('truncates long text', () => {
      const longText = 'This is a very long text that needs to be truncated';
      expect(truncateText(longText, 20)).toBe('This is a very long...');
    });

    it('preserves short text', () => {
      const shortText = 'Short text';
      expect(truncateText(shortText, 20)).toBe(shortText);
    });

    it('handles exact length', () => {
      const exactText = 'Exactly twenty chars';
      expect(truncateText(exactText, 20)).toBe(exactText);
    });

    it('handles empty text', () => {
      expect(truncateText('', 10)).toBe('');
    });

    it('handles zero max length', () => {
      expect(truncateText('Hello world', 0)).toBe('...');
    });
  });
});