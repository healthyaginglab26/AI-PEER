// services/GCS_Service.js
// Handles GCS operations for video and model retrieval
// In production: generates HIPAA-compliant signed URLs with expiration
// In local dev without GCP keys: serves local static mock assets

const { Storage } = require('@google-cloud/storage');
const { IAMCredentialsClient } = require('@google-cloud/iam-credentials').v1;

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
const isCloudRun = !!process.env.K_SERVICE;

// initialize GCS client only if credentials exist or in cloud run
let storage = null;
if (process.env.GCS_PRIVATE_KEY || isCloudRun) {
    const storageConfig = {
        projectId: process.env.GCS_PROJECT_ID
    };

    if (process.env.GCS_PRIVATE_KEY) {
        storageConfig.credentials = {
            client_email: process.env.GCS_CLIENT_EMAIL,
            private_key: process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }

    try {
        storage = new Storage(storageConfig);
    } catch (e) {
        console.warn('[STORAGE] GCS Storage initialization warning:', e.message);
    }
}

// bucket where videos are stored
const bucketName = process.env.GCS_BUCKET_NAME || 'aipeer_videos';
const clientEmail = process.env.GCS_CLIENT_EMAIL;

// initialize IAM client for Cloud Run signing (only when needed)
let iamClient;
if (isCloudRun && !process.env.GCS_PRIVATE_KEY) {
    iamClient = new IAMCredentialsClient();
}

/**
 * Generate signed URL for a video or model file.
 * Falls back to local static mock assets in development mode.
 */
async function generateSignedUrl(videoFileName, overrideBucket) {
    // 1. Zero-Credential Local Development Fallback
    if (!process.env.GCS_PRIVATE_KEY && !isCloudRun) {
        if (isProduction) {
            throw new Error('SECURITY_VIOLATION: Missing GCS credentials in production environment.');
        }

        const host = process.env.LOCAL_API_HOST || `http://localhost:${process.env.PORT || 8080}`;
        if (overrideBucket && overrideBucket === process.env.GCS_MODEL_BUCKET) {
            console.log(`[MOCK GCS] Serving local dummy model asset: ${videoFileName}`);
            return `${host}/mock-assets/dummy-qwen.gguf`;
        }

        console.log(`[MOCK GCS] Serving local mock exercise video asset: ${videoFileName}`);
        return `${host}/mock-assets/sample-exercise.mp4`;
    }

    // 2. Production / Cloud Run GCS Signed URL Flow
    try {
        if (!storage) {
            throw new Error('Google Cloud Storage client is not initialized.');
        }

        const targetBucket = overrideBucket || bucketName;
        const file = storage.bucket(targetBucket).file(videoFileName);

        const options = {
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000 // 1 hour
        };

        if (isCloudRun && !process.env.GCS_PRIVATE_KEY) {
            options.credentials = {
                client_email: clientEmail,
                sign: async (stringToSign) => {
                    const [response] = await iamClient.signBlob({
                        name: `projects/-/serviceAccounts/${clientEmail}`,
                        payload: Buffer.from(stringToSign),
                    });
                    return response.signedBlob.toString('base64');
                }
            };
        }

        const [signedURL] = await file.getSignedUrl(options);
        return signedURL;
    } catch (error) {
        console.error('Error generating signed URL:', error);
        throw new Error('Cannot generate the video URL');
    }
}

module.exports = { generateSignedUrl };