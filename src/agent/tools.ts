import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { insertPlant, listPlants, getPlant, getHealthChecksForPlant, insertHealthCheck } from '../db/queries';
import { identifyPlant, assessPlantHealth } from '../services/plantid';
import { resizeImage } from '../utils/image';

export const addPlantTool = tool(
  async ({ name, species, notes }) => {
    const plant = insertPlant(name, species, notes);
    return JSON.stringify(plant);
  },
  {
    name: 'add_plant',
    description: 'Add a new plant to the database',
    schema: z.object({
      name: z.string().describe('Common name for the plant'),
      species: z.string().optional().describe('Scientific species name'),
      notes: z.string().optional().describe('Any extra notes about the plant'),
    }),
  }
);

export const listPlantsTool = tool(
  async () => {
    const plants = listPlants();
    return JSON.stringify(plants);
  },
  {
    name: 'list_plants',
    description: 'List all plants in the database',
    schema: z.object({}),
  }
);

export const getPlantTool = tool(
  async ({ id }) => {
    const plant = getPlant(id);
    if (!plant) return JSON.stringify({ error: `Plant with id ${id} not found` });
    return JSON.stringify(plant);
  },
  {
    name: 'get_plant',
    description: 'Get details about a specific plant by ID',
    schema: z.object({
      id: z.number().describe('The plant ID'),
    }),
  }
);

export const getPlantHistoryTool = tool(
  async ({ plant_id }) => {
    const checks = getHealthChecksForPlant(plant_id);
    return JSON.stringify(checks);
  },
  {
    name: 'get_plant_history',
    description: 'Get health check history for a specific plant',
    schema: z.object({
      plant_id: z.number().describe('The plant ID to get history for'),
    }),
  }
);

export const identifyPlantTool = tool(
  async ({ photo_path }) => {
    const resized = await resizeImage(photo_path);
    const result = await identifyPlant(resized);
    return JSON.stringify(result);
  },
  {
    name: 'identify_plant',
    description: 'Identify a plant from a photo using the Plant.id API',
    schema: z.object({
      photo_path: z.string().describe('Path to the plant photo'),
    }),
  }
);

export const assessHealthTool = tool(
  async ({ photo_path, plant_id }) => {
    const resized = await resizeImage(photo_path);
    const result = await assessPlantHealth(resized);
    return JSON.stringify({ plant_id, result });
  },
  {
    name: 'assess_plant_health',
    description: 'Assess the health of a plant from a photo using the Plant.id API',
    schema: z.object({
      photo_path: z.string().describe('Path to the plant photo'),
      plant_id: z.number().optional().describe('Optional plant ID to associate with this health check'),
    }),
  }
);

export const saveHealthCheckTool = tool(
  async ({ plant_id, photo_path, plantid_raw, diagnosis }) => {
    const raw = typeof plantid_raw === 'string' ? JSON.parse(plantid_raw) : plantid_raw;
    const record = insertHealthCheck(plant_id ?? null, photo_path, raw, diagnosis);
    return JSON.stringify(record);
  },
  {
    name: 'save_health_check',
    description: 'Save a health check result to the database',
    schema: z.object({
      plant_id: z.number().optional().describe('Plant ID to associate with this check'),
      photo_path: z.string().describe('Path to the original photo'),
      plantid_raw: z.string().describe('Raw Plant.id API result as JSON string'),
      diagnosis: z.string().describe('Claude-generated diagnosis text'),
    }),
  }
);

export const allTools = [
  addPlantTool,
  listPlantsTool,
  getPlantTool,
  getPlantHistoryTool,
  identifyPlantTool,
  assessHealthTool,
  saveHealthCheckTool,
];
