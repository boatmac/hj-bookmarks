/* Encrypted synchronization envelope. */
/* eslint-disable no-unused-vars -- Shared by ordered classic scripts. */
'use strict';

async function encryptSyncData(dataset, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveSyncKey(passphrase, salt, PBKDF2_ITERATIONS, ['encrypt']);
    const plaintext = new TextEncoder().encode(JSON.stringify({
        format: 'bookmark-manager-sync',
        version: 2,
        updatedAt: new Date().toISOString(),
        items: dataset.items,
        tombstones: dataset.tombstones,
    }));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return `${JSON.stringify({
        format: 'bookmark-manager-encrypted-sync',
        version: 1,
        kdf: {
            name: 'PBKDF2',
            hash: 'SHA-256',
            iterations: PBKDF2_ITERATIONS,
            salt: bytesToBase64(salt),
        },
        cipher: {
            name: 'AES-GCM',
            iv: bytesToBase64(iv),
            data: bytesToBase64(new Uint8Array(ciphertext)),
        },
    }, null, 2)}\n`;
}

async function decryptSyncData(content, passphrase) {
    let envelope;
    try {
        envelope = JSON.parse(content);
    } catch {
        throw new Error(t('syncRemoteInvalid'));
    }
    const iterations = Number(envelope?.kdf?.iterations);
    if (
        envelope?.format !== 'bookmark-manager-encrypted-sync'
        || envelope?.version !== 1
        || envelope?.kdf?.name !== 'PBKDF2'
        || envelope?.cipher?.name !== 'AES-GCM'
        || !Number.isInteger(iterations)
        || iterations < 10000
        || iterations > 1000000
    ) {
        throw new Error(t('syncRemoteInvalid'));
    }

    try {
        const salt = base64ToBytes(envelope.kdf.salt);
        const iv = base64ToBytes(envelope.cipher.iv);
        const ciphertext = base64ToBytes(envelope.cipher.data);
        if (salt.length < 16 || iv.length !== 12 || !ciphertext.length) throw new Error('invalid encrypted data');
        const key = await deriveSyncKey(passphrase, salt, iterations, ['decrypt']);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
        throw new Error(t('syncDecryptFailed'));
    }
}

async function deriveSyncKey(passphrase, salt, iterations, usages) {
    const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(String(passphrase).normalize('NFKC')),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        usages,
    );
}

function bytesToBase64(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
