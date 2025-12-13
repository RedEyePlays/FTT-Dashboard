import CryptoJS from 'crypto-js';

const SALT = 'biztrack-secure-salt-v1';

export const encryptData = (data: any, pin: string): string => {
  try {
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, pin + SALT).toString();
    return encrypted;
  } catch (e) {
    console.error("Encryption failed", e);
    throw new Error("Failed to encrypt data");
  }
};

export const decryptData = (encryptedString: string, pin: string): any => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedString, pin + SALT);
    const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedString) throw new Error("Wrong PIN");
    return JSON.parse(decryptedString);
  } catch (e) {
    throw new Error("Decryption failed. Incorrect PIN or corrupted data.");
  }
};

export const isEncrypted = (storedValue: string | null): boolean => {
  if (!storedValue) return false;
  try {
    // Simple heuristic: JSON usually starts with [ or {
    // Encrypted string (Base64) usually doesn't look like JSON
    JSON.parse(storedValue);
    return false;
  } catch (e) {
    return true;
  }
};