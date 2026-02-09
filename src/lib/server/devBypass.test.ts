import { describe, it, expect } from 'vitest';
import { isLocalhostHost, canUseDevBypass, parseStudentId } from './devBypass';

describe('devBypass helpers', () => {
  describe('isLocalhostHost', () => {
    it('should return true for localhost', () => {
      expect(isLocalhostHost('localhost')).toBe(true);
      expect(isLocalhostHost('LOCALHOST')).toBe(true);
    });

    it('should return true for 127.0.0.1', () => {
      expect(isLocalhostHost('127.0.0.1')).toBe(true);
    });

    it('should return true for IPv6 localhost', () => {
      expect(isLocalhostHost('::1')).toBe(true);
      expect(isLocalhostHost('[::1]')).toBe(true);
    });

    it('should return false for non-localhost', () => {
      expect(isLocalhostHost('example.com')).toBe(false);
      expect(isLocalhostHost('192.168.1.1')).toBe(false);
    });
  });

  describe('canUseDevBypass', () => {
    it('should allow dev bypass in development on localhost', () => {
      expect(canUseDevBypass({ nodeEnv: 'development', hostname: 'localhost' })).toBe(true);
      expect(canUseDevBypass({ nodeEnv: 'development', hostname: '127.0.0.1' })).toBe(true);
    });

    it('should disallow dev bypass in production', () => {
      expect(canUseDevBypass({ nodeEnv: 'production', hostname: 'localhost' })).toBe(false);
    });

    it('should disallow dev bypass on non-localhost', () => {
      expect(canUseDevBypass({ nodeEnv: 'development', hostname: 'example.com' })).toBe(false);
    });
  });

  describe('parseStudentId', () => {
    const validUuid = 'd9d510a0-20fb-4c70-8a57-d984bb97299a';

    it('should parse valid UUID', () => {
      expect(parseStudentId(validUuid)).toBe(validUuid);
    });

    it('should parse composite key and extract UUID', () => {
      expect(parseStudentId(`${validUuid}:lichess`)).toBe(validUuid);
      expect(parseStudentId(`${validUuid}:chesscom`)).toBe(validUuid);
    });

    it('should return null for invalid input', () => {
      expect(parseStudentId(null)).toBe(null);
      expect(parseStudentId(undefined)).toBe(null);
      expect(parseStudentId('')).toBe(null);
      expect(parseStudentId('not-a-uuid')).toBe(null);
      expect(parseStudentId('invalid:platform')).toBe(null);
    });

    it('should handle empty string', () => {
      expect(parseStudentId('')).toBe(null);
    });
  });
});

