/**
 * modelDownloader.ts - Download model with progress tracking
 *
 * Handles:
 * - Fetching a signed download URL from the API (private GCS bucket)
 * - Downloading large model files with progress callbacks
 * - Checking if model already exists (skip re-download)
 * - Resume support if download is interrupted
 * - Cleaning up old model files when upgrading
 *
 * Uses expo-file-system legacy API for proper streaming download
 * support with large files (~1.2GB model).
 */

import { Platform } from 'react-native';
import {
  documentDirectory,
  getInfoAsync,
  deleteAsync,
  moveAsync,
  createDownloadResumable,
} from 'expo-file-system/legacy';
import { MODEL_FILENAME, MODEL_SIZE_BYTES, OLD_MODEL_FILENAMES } from './config';
import { api } from '../api';

/** Get the full path where the model will be stored */
export function getModelPath(): string {
  return `${documentDirectory}${MODEL_FILENAME}`;
}

/** Get the temporary .part path used while downloading */
function getTempModelPath(): string {
  return `${getModelPath()}.part`;
}

/** Check if the model file already exists on disk and meets the full expected size */
export async function isModelDownloaded(): Promise<boolean> {
  if (Platform.OS === 'web' || process.env.EXPO_PUBLIC_FORCE_MOCK_LLM === 'true') {
    return true; // Bypass 1.2GB model download on Web (Mode 1)
  }

  const modelPath = getModelPath();
  const fileInfo = await getInfoAsync(modelPath);

  if (!fileInfo.exists) {
    return false;
  }

  // Require the full expected byte size so partial/truncated files never pass
  if (typeof fileInfo.size !== 'number' || fileInfo.size < MODEL_SIZE_BYTES) {
    console.log(
      `Model file incomplete (${fileInfo.size ?? 'unknown'} / ${MODEL_SIZE_BYTES} bytes), deleting for clean re-download`
    );
    await deleteAsync(modelPath, { idempotent: true });
    return false;
  }

  return true;
}

/** Delete the model file and any leftover .part file (for cleanup or re-download) */
export async function deleteModel(): Promise<void> {
  await deleteAsync(getModelPath(), { idempotent: true });
  await deleteAsync(getTempModelPath(), { idempotent: true });
}

/** Remove old model files from previous versions to free up disk space */
export async function cleanupOldModels(): Promise<void> {
  for (const filename of OLD_MODEL_FILENAMES) {
    const path = `${documentDirectory}${filename}`;
    const info = await getInfoAsync(path);
    if (info.exists) {
      console.log(`Cleaning up old model: ${filename}`);
      await deleteAsync(path, { idempotent: true });
    }
  }
}

/**
 * Download the model file with progress tracking
 *
 * @param token - Firebase auth token for API authentication
 * @param onProgress - Callback with progress percentage (0-100)
 * @returns Promise that resolves when download completes
 * @throws Error if download fails
 */
export async function downloadModel(
  token: string,
  onProgress: (progress: number) => void
): Promise<string> {
  const modelPath = getModelPath();
  const partPath = getTempModelPath();

  // Check if already downloaded
  const alreadyExists = await isModelDownloaded();
  if (alreadyExists) {
    console.log('Model already downloaded');
    await deleteAsync(partPath, { idempotent: true });
    onProgress(100);
    return modelPath;
  }

  // Clean up old model files and any leftover .part download
  await cleanupOldModels();
  await deleteAsync(partPath, { idempotent: true });

  // Fetch signed download URL from the API
  console.log('Fetching signed model URL from API...');
  const { modelUrl } = await api.getModelURL(token);
  console.log('Got signed URL, starting download...');

  console.log('Downloading to temp file:', partPath);

  // Create download resumable for progress tracking
  // This streams the file directly to disk without loading into memory
  const downloadResumable = createDownloadResumable(
    modelUrl,
    partPath,
    {},
    (downloadProgress) => {
      const progress =
        (downloadProgress.totalBytesWritten /
          downloadProgress.totalBytesExpectedToWrite) *
        100;
      onProgress(Math.round(progress));
    }
  );

  try {
    const result = await downloadResumable.downloadAsync();

    if (!result || !result.uri) {
      throw new Error('Download failed - no result returned');
    }

    const partInfo = await getInfoAsync(partPath);
    if (!partInfo.exists || typeof partInfo.size !== 'number' || partInfo.size < MODEL_SIZE_BYTES) {
      throw new Error(
        `Downloaded model is incomplete (${partInfo.exists ? partInfo.size : 0} / ${MODEL_SIZE_BYTES} bytes)`
      );
    }

    await deleteAsync(modelPath, { idempotent: true });
    await moveAsync({ from: partPath, to: modelPath });

    console.log('Model download complete:', modelPath);
    return modelPath;
  } catch (error) {
    // Clean up partial download on failure
    await deleteAsync(partPath, { idempotent: true });
    throw error;
  }
}

/**
 * Get model file size in MB (for display)
 */
export function getModelSizeMB(): number {
  return Math.round(MODEL_SIZE_BYTES / (1024 * 1024));
}
