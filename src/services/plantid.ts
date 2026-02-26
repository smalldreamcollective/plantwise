import axios from 'axios';
import dotenv from 'dotenv';
import { imageToBase64, mimeTypeFromPath } from '../utils/image';

dotenv.config();

const BASE_URL = 'https://api.plant.id/v3';

function getApiKey(): string {
  const key = process.env.PLANTID_API_KEY;
  if (!key) throw new Error('PLANTID_API_KEY is not set in environment');
  return key;
}

export interface PlantIdIdentifyResult {
  access_token: string;
  model_version: string;
  custom_id: string | null;
  input: object;
  result: {
    is_plant: { probability: number; binary: boolean; threshold: number };
    classification: {
      suggestions: Array<{
        id: string;
        name: string;
        probability: number;
        similar_images: Array<{ id: string; url: string; similarity: number }>;
        details?: Record<string, unknown>;
      }>;
    };
  };
  status: string;
  sla_compliant_client: boolean;
  sla_compliant_system: boolean;
  created: number;
  completed: number;
}

export interface PlantIdHealthResult {
  access_token: string;
  model_version: string;
  custom_id: string | null;
  input: object;
  result: {
    is_plant: { probability: number; binary: boolean; threshold: number };
    is_healthy: { probability: number; binary: boolean; threshold: number };
    disease: {
      suggestions: Array<{
        id: string;
        name: string;
        probability: number;
        similar_images: Array<{ id: string; url: string; similarity: number }>;
        details?: Record<string, unknown>;
      }>;
    };
  };
  status: string;
  sla_compliant_client: boolean;
  sla_compliant_system: boolean;
  created: number;
  completed: number;
}

export async function identifyPlant(imagePath: string): Promise<PlantIdIdentifyResult> {
  const base64 = imageToBase64(imagePath);
  const mime = mimeTypeFromPath(imagePath);

  const response = await axios.post(
    `${BASE_URL}/identification`,
    {
      images: [`data:${mime};base64,${base64}`],
      similar_images: true,
    },
    {
      headers: {
        'Api-Key': getApiKey(),
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data as PlantIdIdentifyResult;
}

export async function assessPlantHealth(imagePath: string): Promise<PlantIdHealthResult> {
  const base64 = imageToBase64(imagePath);
  const mime = mimeTypeFromPath(imagePath);

  const response = await axios.post(
    `${BASE_URL}/health_assessment`,
    {
      images: [`data:${mime};base64,${base64}`],
      similar_images: true,
    },
    {
      headers: {
        'Api-Key': getApiKey(),
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data as PlantIdHealthResult;
}
