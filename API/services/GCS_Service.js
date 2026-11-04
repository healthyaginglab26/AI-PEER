// services/GCS_Service.js
// Handles GCS operations for video and model retrieval
// In production: generates HIPAA-compliant signed URLs with expiration
// In local dev without GCP keys: serves local static mock assets or real HuggingFace GGUF fallback

const fs = require('fs');
const path = require('path');
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
const modelBucketName = process.env.GCS_MODEL_BUCKET || 'qwenfinetune';
const clientEmail = process.env.GCS_CLIENT_EMAIL;

// Public Qwen3.5-2B Q4_K_M GGUF fallback when running local dev without GCS service account keys
const DEFAULT_HF_GGUF_URL =
    process.env.FALLBACK_MODEL_URL ||
    'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf';

// initialize IAM client for Cloud Run signing (only when needed)
let iamClient;
if (isCloudRun && !process.env.GCS_PRIVATE_KEY) {
    iamClient = new IAMCredentialsClient();
}

/**
 * Generate signed URL for a video or model file.
 * Falls back to local static assets (or HuggingFace GGUF for real on-device LLM) in development mode.
 */
async function generateSignedUrl(videoFileName, overrideBucket) {
    // 1. Zero-Credential Local Development Fallback
    if (!process.env.GCS_PRIVATE_KEY && !isCloudRun) {
        if (isProduction) {
            throw new Error('SECURITY_VIOLATION: Missing GCS credentials in production environment.');
        }

        const host = process.env.LOCAL_API_HOST || `http://localhost:${process.env.PORT || 8080}`;
        if (overrideBucket && overrideBucket === modelBucketName) {
            // Check if the developer placed the real 1.2GB fine-tuned GGUF in API/mock-assets/
            const localGgufPath = path.join(__dirname, '..', 'mock-assets', 'Qwen3.5-2B-aipeer-Q4_K_M.gguf');
            try {
                const stat = fs.statSync(localGgufPath);
                if (stat.size > 100 * 1024 * 1024) {
                    console.log(`[LOCAL GCS] Serving local fine-tuned GGUF model from mock-assets (${Math.round(stat.size / (1024 * 1024))} MB)`);
                    return `${host}/mock-assets/Qwen3.5-2B-aipeer-Q4_K_M.gguf`;
                }
            } catch {}

            console.log(`[LOCAL GCS] No GCS_PRIVATE_KEY configured; serving real Qwen3.5-2B Q4_K_M GGUF from HuggingFace: ${DEFAULT_HF_GGUF_URL}`);
            return DEFAULT_HF_GGUF_URL;
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
