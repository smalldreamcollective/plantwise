import { describe, expect, it } from 'vitest';
import { imageToBase64, mimeTypeFromPath, resizeImage } from './image';

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
});

describe('resizeImage', () => {
  it('throws with a clear message when the file does not exist (relative path)', async () => {
    await expect(resizeImage('nonexistent/plant.jpg')).rejects.toThrow('Image not found');
  });

  it('throws with a clear message when the file does not exist (absolute path)', async () => {
    await expect(resizeImage('/nonexistent/path/to/plant.jpg')).rejects.toThrow('Image not found');
  });

  describe('path traversal protection', () => {
    it('rejects paths with .. sequences', async () => {
      await expect(resizeImage('../etc/passwd')).rejects.toThrow('Invalid input path');
    });

    it('rejects paths with .. in the middle', async () => {
      await expect(resizeImage('photos/../../../etc/passwd')).rejects.toThrow('Invalid input path');
    });
  });
});

describe('imageToBase64', () => {
  describe('path traversal protection', () => {
    it('rejects paths with .. sequences', () => {
      expect(() => imageToBase64('../etc/passwd')).toThrow('Invalid file path');
    });

    it('rejects paths with .. in the middle', () => {
      expect(() => imageToBase64('photos/../../../etc/passwd')).toThrow('Invalid file path');
    });
  });
});
