#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { runAgent } from '../agent/graph';
import {
  getHealthChecksForPlant,
  getPlant,
  getPlantWithWatering,
  getPlantsOverdueForWatering,
  insertPlant,
  listPlants,
  logWatering,
  removePlant,
} from '../db/queries';

dotenv.config();

const program = new Command();

program.name('plantwise').description('AI-powered houseplant care assistant').version('0.1.0');

function formatDaysAgo(days: number | null): string {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

program
  .command('add <name>')
  .description('Add a new plant to your collection')
  .option('-s, --species <species>', 'Scientific species name')
  .option('-n, --notes <notes>', 'Additional notes about the plant')
  .action((name: string, options: { species?: string; notes?: string }) => {
    try {
      const plant = insertPlant(name, options.species, options.notes);
      console.log(
        `Added plant: ${plant.name}${plant.species ? ` (${plant.species})` : ''} [ID: ${plant.id}]`
      );
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('water <id>')
  .description('Log that you watered a plant')
  .action((id: string) => {
    const plantId = parseInt(id, 10);
    if (isNaN(plantId)) {
      console.error('Error: plant ID must be a number');
      process.exit(1);
    }
    try {
      const plant = getPlant(plantId);
      if (!plant) {
        console.error(`Error: No plant found with ID ${plantId}`);
        process.exit(1);
      }
      const log = logWatering(plantId);
      const date = log.watered_at.split('T')[0] ?? log.watered_at;
      console.log(`Watered ${plant.name} [ID: ${plant.id}] on ${date}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('remind')
  .description('List plants that are overdue for watering')
  .action(() => {
    try {
      const overdue = getPlantsOverdueForWatering();
      if (overdue.length === 0) {
        console.log('All plants are on schedule. Nothing needs watering right now.');
        return;
      }
      console.log(`Plants overdue for watering (${overdue.length}):\n`);
      for (const p of overdue) {
        const species = p.species ? ` — ${p.species}` : '';
        const watered = formatDaysAgo(p.days_since_watered);
        const interval = `every ${p.watering_interval_days}d`;
        console.log(`  [${p.id}] ${p.name}${species}`);
        console.log(`       Last watered: ${watered}  (${interval})`);
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('remove <id>')
  .description('Remove a plant from your collection')
  .action(async (id: string) => {
    const plantId = parseInt(id, 10);
    if (isNaN(plantId)) {
      console.error('Error: plant ID must be a number');
      process.exit(1);
    }
    try {
      const plant = getPlant(plantId);
      if (!plant) {
        console.error(`Error: No plant found with ID ${plantId}`);
        process.exit(1);
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `Remove "${plant.name}" [ID: ${plant.id}] and all its history? (y/N) `,
          resolve
        );
      });
      rl.close();

      if (answer.trim().toLowerCase() !== 'y') {
        console.log('Cancelled.');
        return;
      }

      removePlant(plantId);
      console.log(`Removed "${plant.name}" [ID: ${plant.id}]`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('identify <photo>')
  .description('Identify a plant from a photo')
  .action(async (photo: string) => {
    const userMessage = `Identify the plant in the photo at path "${photo}". Use the identify_plant tool and summarize the top matches.`;

    try {
      const result = await runAgent('identify', photo, null, userMessage);
      console.log(result);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('diagnose <photo>')
  .description('Diagnose plant health from a photo')
  .option('-p, --plant <id>', 'Associate with an existing plant ID', parseInt)
  .action(async (photo: string, options: { plant?: number }) => {
    const plantId = options.plant ?? null;
    const userMessage = `Assess the health of the plant in the photo at path "${photo}".${plantId ? ` Associate with plant ID ${plantId}.` : ''} Use the assess_plant_health tool, then save the results with save_health_check, and provide a clear diagnosis with care recommendations.`;

    try {
      const result = await runAgent('diagnose', photo, plantId, userMessage);
      console.log(result);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('View your plant collection and health history')
  .option('-p, --plant <id>', 'Show status for a specific plant ID', parseInt)
  .action((options: { plant?: number }) => {
    const plantId = options.plant ?? null;

    if (plantId) {
      try {
        const plant = getPlantWithWatering(plantId);
        if (!plant) {
          console.error(`Error: No plant found with ID ${plantId}`);
          process.exit(1);
        }
        const species = plant.species ? ` (${plant.species})` : '';
        console.log(`\n${plant.name}${species} [ID: ${plant.id}]`);
        if (plant.notes) console.log(`  Notes: ${plant.notes}`);
        console.log(`  Watering interval: every ${plant.watering_interval_days} days`);
        console.log(`  Last watered: ${formatDaysAgo(plant.days_since_watered)}`);

        const checks = getHealthChecksForPlant(plantId);
        if (checks.length === 0) {
          console.log('\n  No health checks recorded yet.');
        } else {
          console.log(`\n  Health history (${checks.length}):`);
          for (const c of checks) {
            const date = c.created_at.split('T')[0] ?? c.created_at;
            console.log(`    [${date}] ${c.diagnosis}`);
          }
        }
        console.log();
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
      return;
    }

    // No --plant flag: list all plants directly
    try {
      const plants = listPlants();
      if (plants.length === 0) {
        console.log('No plants in your collection yet. Use "plantwise add <name>" to get started.');
        return;
      }
      console.log(`Your plants (${plants.length}):\n`);
      for (const p of plants) {
        const species = p.species ? ` — ${p.species}` : '';
        const notes = p.notes ? `\n     Notes: ${p.notes}` : '';
        console.log(`  [${p.id}] ${p.name}${species}${notes}`);
      }
    } catch (err) {
      console.error('Error reading database:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const helpText: Record<string, string> = {
  add: `
  add <name> [options]
    Add a plant to your collection.

    Options:
      --species <species>   Scientific species name
      --notes <notes>       Additional notes

    Examples:
      npm run add -- "Monstera"
      npm run add -- "Snake Plant" --species "Sansevieria trifasciata"
      npm run add -- "Fiddle Leaf Fig" --species "Ficus lyrata" --notes "Near south window"
`,
  water: `
  water <id>
    Log that you watered a plant.

    Examples:
      npm run water -- 1
`,
  remind: `
  remind
    List all plants that are overdue for watering based on their watering interval.

    Examples:
      npm run remind
`,
  remove: `
  remove <id>
    Remove a plant and all its history from your collection (prompts for confirmation).

    Examples:
      npm run remove -- 1
`,
  status: `
  status [options]
    List all plants, or show health history for a specific plant.

    Options:
      --plant <id>   Plant ID to show detailed status and history

    Examples:
      npm run status
      npm run status -- --plant 1
`,
  identify: `
  identify <photo>
    Identify a plant from a photo using AI. Requires API keys.
    The photo is resized to 1024px before submission.

    Examples:
      npm run identify -- ./photo.jpg
`,
  diagnose: `
  diagnose <photo> [options]
    Assess plant health from a photo using AI. Requires API keys.
    Results are saved to the database automatically.

    Options:
      --plant <id>   Associate the result with a plant in your collection

    Examples:
      npm run diagnose -- ./photo.jpg
      npm run diagnose -- ./photo.jpg --plant 1
`,
  help: `
  help [command]
    Show help for all commands, or detailed help for a specific command.

    Examples:
      npm run help
      npm run help -- add
      npm run help -- diagnose
`,
};

program
  .command('help-guide [command]')
  .description('Show help for all commands, or detailed help for a specific command')
  .action((command?: string) => {
    if (command) {
      const entry = helpText[command];
      if (entry) {
        console.log(`\nPlantWise — help: ${command}\n${entry}`);
      } else {
        console.log(`\nUnknown command: "${command}"\n`);
        console.log(`Available commands: ${Object.keys(helpText).join(', ')}\n`);
      }
      return;
    }

    console.log(`
PlantWise — AI-powered houseplant care assistant

COMMANDS

  add       Add a plant to your collection
  water     Log that you watered a plant
  remind    List plants overdue for watering
  remove    Remove a plant from your collection
  status    List your collection or view a plant's health history
  identify  Identify a plant from a photo (requires API keys)
  diagnose  Assess plant health from a photo (requires API keys)
  help      Show this help, or detailed help for a command

Run "npm run help -- <command>" for usage examples.

  npm run help -- add
  npm run help -- water
  npm run help -- remind
  npm run help -- remove
  npm run help -- status
  npm run help -- identify
  npm run help -- diagnose
`);
  });

program.parse(process.argv);
