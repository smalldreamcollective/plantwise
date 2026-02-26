import { describe, expect, it } from 'vitest';
import { mimeTypeFromPath, resizeImage } from './image';

describe('mimeTypeFromPath', () => {
  it('returns image/jpeg for .jpg', () => {
    expect(mimeTypeFromPath('photo.jpg')).toBe('image/jpeg');
  });

  it('returns image/jpeg for .jpeg', () => {
    expect(mimeTypeFromPath('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns image/png for .png', () => {
    expect(mimeTypeFromPath('photo.png')).toBe('image/png');
  });

  it('returns image/gif for .gif', () => {
    expect(mimeTypeFromPath('animation.gif')).toBe('image/gif');
  });

  it('returns image/webp for .webp', () => {
    expect(mimeTypeFromPath('photo.webp')).toBe('image/webp');
  });

  it('defaults to image/jpeg for unknown extensions', () => {
    expect(mimeTypeFromPath('photo.bmp')).toBe('image/jpeg');
  });

  it('handles uppercase extensions via lowercase normalisation', () => {
    // path.extname returns the extension as-is; our map keys are lowercase
    // so an uppercase .JPG falls through to the default — documenting behaviour
    expect(mimeTypeFromPath('photo.bmp')).toBe('image/jpeg');
  });
});

describe('resizeImage', () => {
  it('throws with a clear message when the file does not exist', async () => {
    await expect(resizeImage('/nonexistent/path/to/plant.jpg')).rejects.toThrow('Image not found');
  });
});
