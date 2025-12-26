import crypto from 'crypto';

function getKeyBytes(): Buffer {
  const raw = process.env.LICHESS_ENCRYPTION_KEY;

  if (!raw || raw.trim().length === 0) {
    throw new Error('LICHESS_ENCRYPTION_KEY is not set');
  }

  const keyStr = raw.trim();

  // Accept base64 OR 64-char hex
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    key = Buffer.from(keyStr, 'hex');
  } else {
    // base64 (may include = padding)
    try {
      key = Buffer.from(keyStr, 'base64');
    } catch {
      throw new Error('LICHESS_ENCRYPTION_KEY must be 32 bytes (base64) or 64-char hex');
    }
  }

  if (key.length !== 32) {
    throw new Error('LICHESS_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

/**
 * Encrypt token using AES-256-GCM.
 * Output format: base64([iv(12) | authTag(16) | ciphertext(N)])
 */
export function encryptToken(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('encryptToken: plain token must be a non-empty string');
  }

  const key = getKeyBytes();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const out = Buffer.concat([iv, authTag, ciphertext]);
  return out.toString('base64');
}

/**
 * Decrypt token using AES-256-GCM.
 * Input format: base64([iv(12) | authTag(16) | ciphertext(N)])
 */
export function decryptToken(encrypted: string): string {
  if (typeof encrypted !== 'string' || encrypted.length === 0) {
    throw new Error('decryptToken: encrypted token must be a non-empty string');
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(encrypted, 'base64');
  } catch {
    throw new Error('decryptToken: encrypted token must be base64');
  }

  if (buf.length < 12 + 16 + 1) {
    throw new Error('decryptToken: invalid payload length');
  }

  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const key = getKeyBytes();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    throw new Error('decryptToken: authentication failed');
  }
}

