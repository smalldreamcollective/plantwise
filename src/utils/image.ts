import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';

const MAX_DIMENSION = 1024;

export async function resizeImage(inputPath: string): Promise<string> {
  if (inputPath.includes('..')) {
    throw new Error('Invalid input path');
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase() || '.jpg';
  const tmpPath = path.join(os.tmpdir(), `plantwise-${Date.now()}${ext}`);

  await sharp(resolved)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .toFile(tmpPath);

  return tmpPath;
}

export function imageToBase64(filePath: string): string {
  if (filePath.includes('..')) {
    throw new Error('Invalid file path');
  }
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}

export function mimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return map[ext] ?? 'image/jpeg';
}
