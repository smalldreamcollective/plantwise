import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');
vi.mock('../utils/image', () => ({
  imageToBase64: vi.fn().mockReturnValue('base64data'),
  mimeTypeFromPath: vi.fn().mockReturnValue('image/jpeg'),
}));

import axios from 'axios';
import { assessPlantHealth, identifyPlant } from './plantid';

const mockIdentifyResponse = {
  data: {
    access_token: 'token-abc',
    model_version: '4.0.0',
    custom_id: null,
    input: {},
    result: {
      is_plant: { probability: 0.99, binary: true, threshold: 0.5 },
      classification: {
        suggestions: [
          {
            id: 'monstera',
            name: 'Monstera deliciosa',
            probability: 0.95,
            similar_images: [{ id: 'img1', url: 'https://example.com/img1.jpg', similarity: 0.9 }],
          },
        ],
      },
    },
    status: 'COMPLETED',
    sla_compliant_client: true,
    sla_compliant_system: true,
    created: 1700000000,
    completed: 1700000001,
  },
};

const mockHealthResponse = {
  data: {
    access_token: 'token-xyz',
    model_version: '4.0.0',
    custom_id: null,
    input: {},
    result: {
      is_plant: { probability: 0.98, binary: true, threshold: 0.5 },
      is_healthy: { probability: 0.85, binary: true, threshold: 0.5 },
      disease: {
        suggestions: [
          {
            id: 'overwatering',
            name: 'Overwatering',
            probability: 0.15,
            similar_images: [],
          },
        ],
      },
    },
    status: 'COMPLETED',
    sla_compliant_client: true,
    sla_compliant_system: true,
    created: 1700000000,
    completed: 1700000001,
  },
};

describe('plantid service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['PLANTID_API_KEY'] = 'test-api-key';
  });

  describe('identifyPlant', () => {
    it('posts to the correct endpoint with image and api key', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockIdentifyResponse);

      await identifyPlant('/photos/plant.jpg');

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.plant.id/v3/identification',
        expect.objectContaining({
          images: ['data:image/jpeg;base64,base64data'],
          similar_images: true,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Api-Key': 'test-api-key' }),
        })
      );
    });

    it('returns the typed result', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockIdentifyResponse);

      const result = await identifyPlant('/photos/plant.jpg');

      expect(result.access_token).toBe('token-abc');
      expect(result.result.classification.suggestions[0]?.name).toBe('Monstera deliciosa');
      expect(result.result.is_plant.binary).toBe(true);
    });

    it('throws when PLANTID_API_KEY is not set', async () => {
      delete process.env['PLANTID_API_KEY'];

      await expect(identifyPlant('/photos/plant.jpg')).rejects.toThrow('PLANTID_API_KEY');
    });

    it('propagates network errors', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

      await expect(identifyPlant('/photos/plant.jpg')).rejects.toThrow('Network error');
    });
  });

  describe('assessPlantHealth', () => {
    it('posts to the health_assessment endpoint', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockHealthResponse);

      await assessPlantHealth('/photos/sick.jpg');

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.plant.id/v3/health_assessment',
        expect.objectContaining({
          images: ['data:image/jpeg;base64,base64data'],
          similar_images: true,
        }),
        expect.anything()
      );
    });

    it('returns the typed health result', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce(mockHealthResponse);

      const result = await assessPlantHealth('/photos/sick.jpg');

      expect(result.result.is_healthy.binary).toBe(true);
      expect(result.result.disease.suggestions[0]?.name).toBe('Overwatering');
    });

    it('throws when PLANTID_API_KEY is not set', async () => {
      delete process.env['PLANTID_API_KEY'];

      await expect(assessPlantHealth('/photos/sick.jpg')).rejects.toThrow('PLANTID_API_KEY');
    });
  });
});
