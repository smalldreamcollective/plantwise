#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { runAgent } from '../agent/graph';
import { insertPlant, listPlants } from '../db/queries';

dotenv.config();

const program = new Command();

program.name('plantwise').description('AI-powered houseplant care assistant').version('0.1.0');

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
  .action(async (options: { plant?: number }) => {
    const plantId = options.plant ?? null;

    let userMessage: string;
    if (plantId) {
      userMessage = `Show the status and health history for plant ID ${plantId}. Use get_plant and get_plant_history tools, then summarize the plant's condition and history.`;
    } else {
      // For listing all plants, we can do it directly without the agent for speed
      try {
        const plants = listPlants();
        if (plants.length === 0) {
          console.log(
            'No plants in your collection yet. Use "plantwise add <name>" to get started.'
          );
          return;
        }
        console.log(`Your plants (${plants.length}):\n`);
        for (const p of plants) {
          const species = p.species ? ` — ${p.species}` : '';
          const notes = p.notes ? `\n     Notes: ${p.notes}` : '';
          console.log(`  [${p.id}] ${p.name}${species}${notes}`);
        }
        return;
      } catch (err) {
        console.error('Error reading database:', err instanceof Error ? err.message : err);
        process.exit(1);
        return;
      }
    }

    try {
      const result = await runAgent('status', null, plantId, userMessage);
      console.log(result);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
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
  status: `
  status [options]
    List all plants, or show health history for a specific plant.

    Options:
      --plant <id>   Plant ID to show detailed history for (requires API keys)

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
  status    List your collection or view a plant's health history
  identify  Identify a plant from a photo (requires API keys)
  diagnose  Assess plant health from a photo (requires API keys)
  help      Show this help, or detailed help for a command

Run "npm run help -- <command>" for usage examples.

  npm run help -- add
  npm run help -- status
  npm run help -- identify
  npm run help -- diagnose
`);
  });

program.parse(process.argv);
