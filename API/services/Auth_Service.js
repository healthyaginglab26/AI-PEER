// services/Auth_Service.js
// Firebase authentication utilities with Zero-Credential Mock Development Support

const { admin } = require("../config/firebaseConfig");

const IDENTITY_PLATFORM_API_KEY = process.env.IDENTITY_PLATFORM_API_KEY;
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
const isDevMock = (process.env.MOCK_AUTH === 'true' || !IDENTITY_PLATFORM_API_KEY) && !isProduction;

function assertMockPermitted() {
    if (isProduction) {
        console.error('[CRITICAL SECURITY AUDIT] Attempted to activate mock authentication in a production environment!');
        throw new Error('SECURITY_VIOLATION: Mock services are strictly forbidden in production.');
    }
}

/**
 * Send SMS verification code via Identity Platform (or Mock Provider in Local Dev)
 * @param {string} phoneNumber - E.164 format phone number (e.g., +15551234567)
 * @returns {Promise<string>} sessionInfo token for verification
 */
async function sendVerificationCode(phoneNumber) {
    if (isDevMock) {
        assertMockPermitted();
        const mockSession = `mock-session-${Date.now()}`;
        console.log(`\n======================================================`);
        console.log(`[MOCK AUTH] SMS 2FA Triggered for phone: ${phoneNumber}`);
        console.log(`[MOCK AUTH] One-Time Passcode (OTP): >>> 123456 <<<`);
        console.log(`======================================================\n`);
        return mockSession;
    }

    if (!IDENTITY_PLATFORM_API_KEY) {
        throw new Error('IDENTITY_PLATFORM_API_KEY not configured');
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${IDENTITY_PLATFORM_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
    });

    const data = await response.json();

    if (!response.ok) {
        const errorCode = data?.error?.message || 'UNKNOWN_ERROR';
        console.error('[AUDIT] SMS send failed:', errorCode, 'phone:', phoneNumber.slice(-4));
        throw new Error(errorCode);
    }

    console.log('[AUDIT] SMS verification code sent: phone=XXXX' + phoneNumber.slice(-4));
    return data.sessionInfo;
}

/**
 * Verify SMS code via Identity Platform (or Mock Provider in Local Dev)
 * @param {string} sessionInfo - Session token from sendVerificationCode
 * @param {string} code - 6-digit verification code
 * @returns {Promise<{idToken: string, refreshToken: string, localId: string}>}
 */
async function verifyCode(sessionInfo, code) {
    if (isDevMock && sessionInfo && sessionInfo.startsWith('mock-session-')) {
        assertMockPermitted();
        if (code === '123456' || code === '000000') {
            console.log('[MOCK AUTH] Verified deterministic mock OTP successfully.');
            return {
                idToken: `mock-dev-id-token-${Date.now()}`,
                refreshToken: `mock-dev-refresh-token-${Date.now()}`,
                localId: 'mock-user-john-senior',
                isNewUser: false
            };
        }
        throw new Error('INVALID_CODE');
    }

    if (!IDENTITY_PLATFORM_API_KEY) {
        throw new Error('IDENTITY_PLATFORM_API_KEY not configured');
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${IDENTITY_PLATFORM_API_KEY}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionInfo, code })
    });

    const data = await response.json();

    if (!response.ok) {
        const errorCode = data?.error?.message || 'UNKNOWN_ERROR';
        console.error('[AUDIT] SMS verification failed:', errorCode);
        throw new Error(errorCode);
    }

    return data;
}

// Verify Firebase ID token (called by authMiddleware)
async function verification(token) {
    if (!token) {
        throw new Error('No authorization token provided');
    }

    if (isDevMock && (token.startsWith('mock-') || token.startsWith('mock-dev-id-token-') || token.startsWith('mock-custom-token-'))) {
        assertMockPermitted();
        let uid = 'mock-user-john-senior';
        if (token.startsWith('mock-custom-token-')) {
            uid = token.replace('mock-custom-token-', '');
        }
        return { uid, email: 'mock-user@aipeer.local' };
    }

    try {
        return await admin.auth().verifyIdToken(token);
    } catch (error) {
        console.error('Error verifying token:', error.message);
        throw new Error('Invalid or expired token');
    }
}

// Create custom token for a verified user (called after password verification)
async function createCustomToken(uid) {
    try {
        if (admin.apps && admin.apps.length && admin.auth) {
            return await admin.auth().createCustomToken(uid);
        }
    } catch (error) {
        if (!isProduction) {
            console.warn('[DEV] Falling back to mock custom token:', error.message);
            return `mock-custom-token-${uid}`;
        }
        throw error;
    }

    if (isDevMock) {
        return `mock-custom-token-${uid}`;
    }

    throw new Error('Firebase Admin Auth not initialized.');
}

module.exports = { verification, createCustomToken, sendVerificationCode, verifyCode };
