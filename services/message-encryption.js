const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:';

function getKey() {
  const secret = process.env.MESSAGE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error('No encryption key configured');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;
  // Don't double-encrypt
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;
  // Don't encrypt file paths or URLs
  if (plaintext.startsWith('/uploads/') || plaintext.startsWith('http')) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return ENCRYPTED_PREFIX + iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;
  // Not encrypted by us
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return ciphertext;

  try {
    const payload = ciphertext.slice(ENCRYPTED_PREFIX.length);
    const parts = payload.split(':');
    if (parts.length !== 3) return ciphertext;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Message decryption failed:', e.message);
    return ciphertext;
  }
}

function decryptRow(row, fields = ['content']) {
  if (!row) return row;
  for (const field of fields) {
    if (row[field]) row[field] = decrypt(row[field]);
  }
  return row;
}

function decryptRows(rows, fields = ['content']) {
  if (!rows || !Array.isArray(rows)) return rows;
  return rows.map(r => decryptRow(r, fields));
}

module.exports = { encrypt, decrypt, decryptRow, decryptRows };
