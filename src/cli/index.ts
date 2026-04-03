#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { runAgent } from '../agent/graph';
import { getDb } from '../db/schema';
import { notify } from '../utils/notify';
import mqtt from 'mqtt';
import { startSubscriber } from '../mqtt/subscriber';
import {
  assignDevice,
  getAllPlantsWithLatestReading,
  getAllPlantsWithMoistureStats,
  getAllSensorReadings,
  getChannelMappingsForDevice,
  getHealthChecksForPlant,
  getLatestSensorReading,
  getPlant,
  getSensorReadings,
  getPlantWithWatering,
  getPlantsOverdueForWatering,
  insertPlant,
  listChannelMappings,
  listDevices,
  listPlants,
  logCareEvent,
  logSensorReading,
  mapChannel,
  removePlant,
  unassignDevice,
  unmapChannel,
  updatePlant,
} from '../db/queries';

dotenv.config();

const program = new Command();

program.name('plantwise').description('AI-powered houseplant care assistant').version('0.1.0');

function formatDate(datetime: string): string {
  // SQLite datetime('now') uses a space separator ("2026-02-27 03:37:00"), not 'T'
  return datetime.split(/[T ]/)[0] ?? datetime;
}

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
  .option('--interval <days>', 'Watering interval in days (default: 7)', parseInt)
  .option('--threshold <pct>', 'Moisture alert threshold 0–100% (default: 30)', parseInt)
  .option('--upper-threshold <pct>', 'Overwatering alert threshold 0–100% (default: 85)', parseInt)
  .action(
    (
      name: string,
      options: {
        species?: string;
        notes?: string;
        interval?: number;
        threshold?: number;
        upperThreshold?: number;
      }
    ) => {
      if (options.interval !== undefined && (isNaN(options.interval) || options.interval < 1)) {
        console.error('Error: --interval must be a positive number');
        process.exit(1);
      }
      if (
        options.threshold !== undefined &&
        (isNaN(options.threshold) || options.threshold < 0 || options.threshold > 100)
      ) {
        console.error('Error: --threshold must be between 0 and 100');
        process.exit(1);
      }
      if (
        options.upperThreshold !== undefined &&
        (isNaN(options.upperThreshold) ||
          options.upperThreshold < 0 ||
          options.upperThreshold > 100)
      ) {
        console.error('Error: --upper-threshold must be between 0 and 100');
        process.exit(1);
      }
      try {
        const plant = insertPlant(
          name,
          options.species,
          options.notes,
          options.interval,
          options.threshold,
          options.upperThreshold
        );
        console.log(
          `Added plant: ${plant.name}${plant.species ? ` (${plant.species})` : ''} [ID: ${plant.id}]`
        );
        console.log(
          `  Watering interval: every ${plant.watering_interval_days} days | Moisture: ${plant.moisture_threshold_pct}%–${plant.moisture_upper_threshold_pct}%`
        );
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }
  );

program
  .command('update <id>')
  .description('Update a plant in your collection')
  .option('-n, --name <name>', 'New name')
  .option('-s, --species <species>', 'Scientific species name')
  .option('--notes <notes>', 'Additional notes')
  .option('--interval <days>', 'Watering interval in days', parseInt)
  .option('--threshold <pct>', 'Moisture threshold percentage (0–100)', parseInt)
  .option('--upper-threshold <pct>', 'Overwatering threshold percentage (0–100)', parseInt)
  .action(
    (
      id: string,
      options: {
        name?: string;
        species?: string;
        notes?: string;
        interval?: number;
        threshold?: number;
        upperThreshold?: number;
      }
    ) => {
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
        const updates: Record<string, string | number> = {};
        if (options.name !== undefined) updates['name'] = options.name;
        if (options.species !== undefined) updates['species'] = options.species;
        if (options.notes !== undefined) updates['notes'] = options.notes;
        if (options.interval !== undefined) {
          if (isNaN(options.interval) || options.interval < 1) {
            console.error('Error: --interval must be a positive number');
            process.exit(1);
          }
          updates['watering_interval_days'] = options.interval;
        }
        if (options.threshold !== undefined) {
          if (isNaN(options.threshold) || options.threshold < 0 || options.threshold > 100) {
            console.error('Error: --threshold must be between 0 and 100');
            process.exit(1);
          }
          updates['moisture_threshold_pct'] = options.threshold;
        }
        if (options.upperThreshold !== undefined) {
          if (
            isNaN(options.upperThreshold) ||
            options.upperThreshold < 0 ||
            options.upperThreshold > 100
          ) {
            console.error('Error: --upper-threshold must be between 0 and 100');
            process.exit(1);
          }
          updates['moisture_upper_threshold_pct'] = options.upperThreshold;
        }
        if (Object.keys(updates).length === 0) {
          console.log(
            'Nothing to update. Use --name, --species, --notes, --interval, --threshold, or --upper-threshold.'
          );
          return;
        }
        const updated = updatePlant(plantId, updates);
        if (!updated) {
          console.error(`Error: No plant found with ID ${plantId}`);
          process.exit(1);
        }
        console.log(`Updated ${updated.name} [ID: ${updated.id}]`);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    }
  );

const logCmd = program.command('log').description('Log a care event for a plant');

function makeLogAction(type: string, pastTense: string) {
  return (id: string, options: { notes?: string }) => {
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
      const event = logCareEvent(plantId, type, options.notes);
      const date = formatDate(event.occurred_at);
      const notesStr = event.notes ? ` — ${event.notes}` : '';
      console.log(`${pastTense} ${plant.name} [ID: ${plant.id}] on ${date}${notesStr}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  };
}

logCmd
  .command('water <id>')
  .description('Log that you watered a plant')
  .option('-n, --notes <notes>', 'Optional notes')
  .action(makeLogAction('water', 'Watered'));

logCmd
  .command('feed <id>')
  .description('Log that you fed a plant')
  .option('-n, --notes <notes>', 'Optional notes')
  .action(makeLogAction('feed', 'Fed'));

logCmd
  .command('repot <id>')
  .description('Log that you repotted a plant')
  .option('-n, --notes <notes>', 'Optional notes')
  .action(makeLogAction('repot', 'Repotted'));

program
  .command('remind')
  .description('List plants that are overdue for watering')
  .option('--notify', 'Fire a desktop notification for each overdue plant')
  .action((options: { notify?: boolean }) => {
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

        if (options.notify) {
          const reading = getLatestSensorReading(p.id);
          const isFreshReading =
            reading !== undefined &&
            Date.now() - new Date(reading.recorded_at).getTime() <= 24 * 60 * 60 * 1000;
          let body: string;
          if (isFreshReading && reading) {
            body = `${p.name} needs water — soil moisture ${reading.moisture_pct}%`;
          } else if (p.days_since_watered === null) {
            body = `${p.name} needs water — never watered`;
          } else {
            body = `${p.name} needs water — last watered ${formatDaysAgo(p.days_since_watered)}`;
          }
          notify(body);
        }
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

      // Extract care recommendations JSON block from response
      const jsonMatch = result.match(/```json\s*([\s\S]*?)\s*```\s*$/);
      const displayText = jsonMatch ? result.slice(0, jsonMatch.index).trim() : result;
      console.log(displayText);

      if (!jsonMatch) return;

      let care: {
        name: string;
        species: string;
        watering_interval_days: number;
        moisture_threshold_pct: number;
        moisture_upper_threshold_pct: number;
        notes: string;
      };

      try {
        care = JSON.parse(jsonMatch[1]);
      } catch {
        return;
      }

      console.log('\nRecommended care:');
      console.log(`  Watering interval : ${care.watering_interval_days} days`);
      console.log(`  Moisture low      : ${care.moisture_threshold_pct}%`);
      console.log(`  Moisture high     : ${care.moisture_upper_threshold_pct}%`);
      if (care.notes) console.log(`  Notes             : ${care.notes}`);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

      const addAnswer = await ask('\nAdd this plant? [Y/n]: ');
      if (addAnswer.trim().toLowerCase() === 'n') {
        rl.close();
        return;
      }

      const nameAnswer = await ask(`Name [${care.name}]: `);
      const name = nameAnswer.trim() || care.name;
      const plant = insertPlant(
        name,
        care.species,
        care.notes || undefined,
        care.watering_interval_days,
        care.moisture_threshold_pct,
        care.moisture_upper_threshold_pct
      );
      console.log(`Added "${plant.name}" [ID: ${plant.id}]`);

      const sensorAnswer = await ask(
        'Assign a sensor to this plant? Enter sensor ID or press Enter to skip: '
      );
      rl.close();

      const sensorId = sensorAnswer.trim();
      if (sensorId) {
        try {
          assignDevice(sensorId, plant.id);
          console.log(`Assigned "${sensorId}" → ${plant.name} [ID: ${plant.id}]`);
        } catch {
          console.warn(
            `Warning: could not assign sensor "${sensorId}" — run: plantwise device assign ${sensorId} ${plant.id}`
          );
        }
      }
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
            const date = formatDate(c.created_at);
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

// ── Sensor ────────────────────────────────────────────────────────────────────

function moistureBar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatRecordedAgo(recorded_at: string): string {
  const diffMs = Date.now() - new Date(recorded_at).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs === 1 ? '1 hr' : `${hrs} hrs`} ago`;
  const days = Math.floor(hrs / 24);
  return `${days === 1 ? '1 day' : `${days} days`} ago`;
}

const sensorCmd = program.command('sensor').description('Manage soil moisture sensor readings');

sensorCmd
  .command('read <id> <moisture>')
  .description('Log a soil moisture reading for a plant (0–100)')
  .option('--source <source>', 'Reading source (manual|emulated|hardware)', 'manual')
  .action((id: string, moisture: string, options: { source: string }) => {
    const plantId = parseInt(id, 10);
    const moisturePct = parseInt(moisture, 10);
    if (isNaN(plantId)) {
      console.error('Error: plant ID must be a number');
      process.exit(1);
    }
    if (isNaN(moisturePct) || moisturePct < 0 || moisturePct > 100) {
      console.error('Error: moisture must be a number between 0 and 100');
      process.exit(1);
    }
    try {
      const plant = getPlant(plantId);
      if (!plant) {
        console.error(`Error: No plant found with ID ${plantId}`);
        process.exit(1);
      }
      logSensorReading(plantId, moisturePct, options.source);
      const status =
        moisturePct > plant.moisture_upper_threshold_pct
          ? 'too wet'
          : moisturePct < plant.moisture_threshold_pct
            ? 'needs water'
            : 'OK';
      console.log(
        `Moisture recorded for ${plant.name} [ID: ${plant.id}]: ${moisturePct}% (low: ${plant.moisture_threshold_pct}% / high: ${plant.moisture_upper_threshold_pct}%) — ${status}`
      );
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

sensorCmd
  .command('simulate <id>')
  .description('Generate an emulated dryout curve for a plant')
  .option('-d, --days <days>', 'Number of days to simulate', '7')
  .action((id: string, options: { days: string }) => {
    const plantId = parseInt(id, 10);
    const days = parseInt(options.days, 10);
    if (isNaN(plantId)) {
      console.error('Error: plant ID must be a number');
      process.exit(1);
    }
    if (isNaN(days) || days < 1) {
      console.error('Error: --days must be a positive number');
      process.exit(1);
    }
    try {
      const plant = getPlant(plantId);
      if (!plant) {
        console.error(`Error: No plant found with ID ${plantId}`);
        process.exit(1);
      }

      const db = getDb();
      const intervalDays = plant.watering_interval_days;
      const totalHours = days * 24;
      // Exponential decay: 90% → 10% over watering_interval_days
      const decayRate = Math.log(90 / 10) / (intervalDays * 24);
      let count = 0;

      const insertReading = db.prepare(
        "INSERT INTO sensor_readings (plant_id, moisture_pct, source, recorded_at) VALUES (?, ?, 'emulated', datetime('now', ?))"
      );

      const insertMany = db.transaction(() => {
        for (let h = totalHours; h >= 0; h--) {
          const rawMoisture = 90 * Math.exp(-decayRate * (totalHours - h));
          const noise = (Math.random() - 0.5) * 10;
          const moisture = Math.min(100, Math.max(0, Math.round(rawMoisture + noise)));
          const offset = `-${h} hours`;
          insertReading.run(plantId, moisture, offset);
          count++;
        }
      });

      insertMany();

      const latest = getLatestSensorReading(plantId);
      const currentMoisture = latest?.moisture_pct ?? 0;
      const status =
        currentMoisture > plant.moisture_upper_threshold_pct
          ? 'too wet'
          : currentMoisture < plant.moisture_threshold_pct
            ? 'needs water'
            : 'OK';
      console.log(
        `Simulated ${count} readings for ${plant.name} [ID: ${plant.id}] over ${days} day${days === 1 ? '' : 's'}`
      );
      console.log(
        `Current simulated moisture: ${currentMoisture}% (low: ${plant.moisture_threshold_pct}% / high: ${plant.moisture_upper_threshold_pct}%) — ${status}`
      );
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

sensorCmd
  .command('status [id]')
  .description('Show the latest moisture reading for one or all plants')
  .action((id?: string) => {
    try {
      if (id !== undefined) {
        const plantId = parseInt(id, 10);
        if (isNaN(plantId)) {
          console.error('Error: plant ID must be a number');
          process.exit(1);
        }
        const plant = getPlant(plantId);
        if (!plant) {
          console.error(`Error: No plant found with ID ${plantId}`);
          process.exit(1);
        }
        const reading = getLatestSensorReading(plantId);
        if (!reading) {
          console.log(`${plant.name} [ID: ${plant.id}] — no sensor readings yet`);
          return;
        }
        const status =
          reading.moisture_pct > plant.moisture_upper_threshold_pct
            ? 'Too wet   '
            : reading.moisture_pct < plant.moisture_threshold_pct
              ? 'Needs water'
              : 'OK         ';
        console.log(
          `${plant.name} [ID: ${plant.id}]  ${reading.moisture_pct}%  ${moistureBar(reading.moisture_pct)}  ${status}  (${formatRecordedAgo(reading.recorded_at)})`
        );
      } else {
        const plants = getAllPlantsWithLatestReading();
        if (plants.length === 0) {
          console.log('No plants in your collection yet.');
          return;
        }
        console.log('\nSoil moisture status:\n');
        for (const p of plants) {
          if (p.moisture_pct === null) {
            console.log(`  [${p.id}] ${p.name.padEnd(18)} —    no readings yet`);
          } else {
            const status =
              p.moisture_pct > p.moisture_upper_threshold_pct
                ? 'Too wet    '
                : p.moisture_pct < p.moisture_threshold_pct
                  ? 'Needs water'
                  : 'OK         ';
            const ago = formatRecordedAgo(p.recorded_at ?? '');
            console.log(
              `  [${p.id}] ${p.name.padEnd(18)} ${String(p.moisture_pct).padStart(3)}%  ${moistureBar(p.moisture_pct)}  ${status}  (${ago})`
            );
          }
        }
        console.log();
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

sensorCmd
  .command('history [id]')
  .description('Show moisture reading history for a plant, or all plants if no ID given')
  .option('-n, --limit <n>', 'Number of readings to show per plant (default: 20)', '20')
  .action((id: string | undefined, options: { limit: string }) => {
    const limit = parseInt(options.limit, 10);
    if (isNaN(limit) || limit < 1) {
      console.error('Error: --limit must be a positive number');
      process.exit(1);
    }
    try {
      if (id === undefined) {
        const readings = getAllSensorReadings(limit);
        if (readings.length === 0) {
          console.log('No sensor readings recorded yet.');
          return;
        }
        let currentPlantId: number | null = null;
        for (const r of readings) {
          if (r.plant_id !== currentPlantId) {
            currentPlantId = r.plant_id;
            console.log(
              `\n${r.plant_name} [ID: ${r.plant_id}] (last ${readings.filter((x) => x.plant_id === r.plant_id).length}):`
            );
          }
          const status =
            r.moisture_pct > r.moisture_upper_threshold_pct
              ? 'too wet   '
              : r.moisture_pct < r.moisture_threshold_pct
                ? 'needs water'
                : 'OK         ';
          console.log(
            `  ${r.recorded_at}  ${String(r.moisture_pct).padStart(3)}%  ${moistureBar(r.moisture_pct)}  ${status}  [${r.source}]`
          );
        }
        console.log();
      } else {
        const plantId = parseInt(id, 10);
        if (isNaN(plantId)) {
          console.error('Error: plant ID must be a number');
          process.exit(1);
        }
        const plant = getPlant(plantId);
        if (!plant) {
          console.error(`Error: No plant found with ID ${plantId}`);
          process.exit(1);
        }
        const readings = getSensorReadings(plantId, limit);
        if (readings.length === 0) {
          console.log(`${plant.name} [ID: ${plant.id}] — no sensor readings yet`);
          return;
        }
        console.log(
          `\nMoisture history for ${plant.name} [ID: ${plant.id}] (last ${readings.length}):\n`
        );
        for (const r of readings) {
          const status =
            r.moisture_pct > plant.moisture_upper_threshold_pct
              ? 'too wet   '
              : r.moisture_pct < plant.moisture_threshold_pct
                ? 'needs water'
                : 'OK         ';
          console.log(
            `  ${r.recorded_at}  ${String(r.moisture_pct).padStart(3)}%  ${moistureBar(r.moisture_pct)}  ${status}  [${r.source}]`
          );
        }
        console.log();
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

sensorCmd
  .command('avg')
  .description('Show average, min, and max moisture for all plants')
  .action(() => {
    try {
      const plants = getAllPlantsWithMoistureStats();
      if (plants.length === 0) {
        console.log('No plants in your collection yet.');
        return;
      }
      console.log('\nMoisture averages:\n');
      for (const p of plants) {
        if (p.reading_count === 0) {
          console.log(`  [${p.id}] ${p.name.padEnd(18)} —  no readings yet`);
        } else {
          const avg = String(p.avg_moisture ?? '—').padStart(3);
          const min = String(p.min_moisture ?? '—').padStart(3);
          const max = String(p.max_moisture ?? '—').padStart(3);
          const bar = moistureBar(p.avg_moisture ?? 0);
          const count = `${p.reading_count} readings`;
          console.log(
            `  [${p.id}] ${p.name.padEnd(18)} avg ${avg}%  ${bar}  min ${min}%  max ${max}%  (${count})`
          );
        }
      }
      console.log();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const deviceCmd = program.command('device').description('Manage sensor device → plant assignments');

deviceCmd
  .command('assign <device-id> <plant-id>')
  .description('Assign a sensor device to a plant')
  .option('-n, --name <name>', 'Optional label for this device')
  .action((deviceId: string, plantIdStr: string, options: { name?: string }) => {
    const plantId = parseInt(plantIdStr, 10);
    if (isNaN(plantId) || plantId < 1) {
      console.error('Error: plant-id must be a positive number');
      process.exit(1);
    }
    try {
      const plant = getPlant(plantId);
      if (!plant) {
        console.error(`Error: No plant found with ID ${plantId}`);
        process.exit(1);
      }
      assignDevice(deviceId, plantId, options.name);
      console.log(`Assigned "${deviceId}" → ${plant.name} [ID: ${plantId}]`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

deviceCmd
  .command('unassign <device-id>')
  .description('Remove a device → plant assignment')
  .action((deviceId: string) => {
    try {
      const removed = unassignDevice(deviceId);
      if (!removed) {
        console.error(`Error: No assignment found for device "${deviceId}"`);
        process.exit(1);
      }
      console.log(`Removed assignment for "${deviceId}"`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

deviceCmd
  .command('list')
  .description('List all device → plant assignments')
  .action(() => {
    try {
      const devices = listDevices();
      if (devices.length === 0) {
        console.log('No devices assigned yet. Run: plantwise device assign <device-id> <plant-id>');
        return;
      }
      console.log('\nDevice assignments:\n');
      for (const d of devices) {
        const label = d.name ? ` (${d.name})` : '';
        console.log(`  ${d.device_id.padEnd(20)} → ${d.plant_name} [ID: ${d.plant_id}]${label}`);
      }
      console.log();
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const channelCmd = program
  .command('channel')
  .description('Manage BBB sensor channel → name mappings');

function publishChannelConfig(deviceId: string): void {
  const host = process.env['MQTT_HOST'] ?? 'localhost';
  const port = parseInt(process.env['MQTT_PORT'] ?? '1883', 10);
  const mappings = getChannelMappingsForDevice(deviceId);
  const payload = JSON.stringify({ channels: mappings });
  const topic = `plantwise/devices/${deviceId}/config`;
  const client = mqtt.connect(`mqtt://${host}:${port}`);
  client.on('connect', () => {
    client.publish(topic, payload, { qos: 1, retain: true }, () => {
      client.end();
      console.log(`Config published to ${topic}`);
    });
  });
  client.on('error', () => {
    client.end();
    console.warn(
      'Warning: could not reach MQTT broker — config saved locally but not sent to device.'
    );
    console.warn(
      `Run again when the broker is available, or restart the BBB service to pick up changes.`
    );
  });
}

channelCmd
  .command('map <device-id> <channel> <sensor-name>')
  .description('Map a mux channel to a sensor name and publish config to the device')
  .action((deviceId: string, channelStr: string, sensorName: string) => {
    const channel = parseInt(channelStr, 10);
    if (isNaN(channel) || channel < 0 || channel > 7) {
      console.error('Error: channel must be a number between 0 and 7');
      process.exit(1);
    }
    try {
      mapChannel(deviceId, channel, sensorName);
      console.log(`Mapped ${deviceId} channel ${channel} → "${sensorName}"`);
      publishChannelConfig(deviceId);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

channelCmd
  .command('unmap <device-id> <channel>')
  .description('Remove a channel mapping and publish updated config to the device')
  .action((deviceId: string, channelStr: string) => {
    const channel = parseInt(channelStr, 10);
    if (isNaN(channel) || channel < 0 || channel > 7) {
      console.error('Error: channel must be a number between 0 and 7');
      process.exit(1);
    }
    try {
      const removed = unmapChannel(deviceId, channel);
      if (!removed) {
        console.error(`Error: No mapping found for ${deviceId} channel ${channel}`);
        process.exit(1);
      }
      console.log(`Removed mapping for ${deviceId} channel ${channel}`);
      publishChannelConfig(deviceId);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

channelCmd
  .command('list [device-id]')
  .description('List all channel mappings, optionally filtered by device')
  .action((deviceId?: string) => {
    try {
      const mappings = listChannelMappings(deviceId);
      if (mappings.length === 0) {
        console.log(
          'No channel mappings yet. Run: plantwise channel map <device-id> <channel> <name>'
        );
        return;
      }
      console.log('\nChannel mappings:\n');
      let lastDevice = '';
      for (const m of mappings) {
        if (m.device_id !== lastDevice) {
          console.log(`  ${m.device_id}`);
          lastDevice = m.device_id;
        }
        console.log(`    ch${m.channel} → ${m.sensor_name}`);
      }
      console.log();
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
      --species <species>          Scientific species name
      --notes <notes>              Additional notes
      --interval <days>            Watering interval in days (default: 7)
      --threshold <pct>            Low moisture alert threshold 0–100% (default: 30)
      --upper-threshold <pct>      Overwatering alert threshold 0–100% (default: 85)

    Examples:
      npm run add -- "Monstera"
      npm run add -- "Snake Plant" --species "Sansevieria trifasciata"
      npm run add -- "Fiddle Leaf Fig" --species "Ficus lyrata" --notes "Near south window"
      npm run add -- "Cactus" --interval 21 --threshold 15 --upper-threshold 80
`,
  log: `
  log <subcommand> <id> [options]
    Log a care event for a plant.

    Subcommands:
      water   Log a watering
      feed    Log a feeding
      repot   Log a repot

    Options:
      --notes <notes>   Optional notes about the event

    Examples:
      npm run log -- water 1
      npm run log -- feed 1 --notes "Osmocote"
      npm run log -- repot 1
`,
  remind: `
  remind [options]
    List all plants that are overdue for watering based on their watering
    interval or latest soil moisture reading.

    Options:
      --notify   Fire a macOS desktop notification for each overdue plant

    Examples:
      npm run remind
      npm run remind -- --notify

    Cron usage (every 30 min):
      */30 * * * * cd /path/to/plantwise && npm run remind -- --notify
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

    After identification, displays care recommendations and prompts you
    to add the plant to your collection with pre-filled values.

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
  sensor: `
  sensor <subcommand> [args]
    Manage soil moisture sensor readings.

    Subcommands:
      read <id> <moisture>   Log a moisture reading (0–100) for a plant
      simulate <id>          Generate an emulated dryout curve
      status [id]            Show latest moisture for one or all plants
      history [id]           Show reading history for a plant, or all plants if no ID given
      avg                    Show avg, min, max moisture for all plants

    Options (read):
      --source <source>   Reading source: manual | emulated | hardware (default: manual)

    Options (simulate):
      --days <n>          Number of days to simulate (default: 7)

    Options (history):
      -n, --limit <n>     Number of readings to show per plant (default: 20)

    Examples:
      npm run sensor -- read 1 45
      npm run sensor -- read 1 42 --source hardware
      npm run sensor -- simulate 1
      npm run sensor -- simulate 1 --days 14
      npm run sensor -- status
      npm run sensor -- status 1
      npm run sensor -- history
      npm run sensor -- history --limit 5
      npm run sensor -- history 1
      npm run sensor -- history 1 --limit 50
      npm run sensor -- avg
`,
  update: `
  update <id> [options]
    Update a plant's details. All options are optional — only provided fields are changed.

    Options:
      --name <name>                New display name
      --species <species>          Scientific species name
      --notes <notes>              Additional notes
      --interval <days>            Watering interval in days
      --threshold <pct>            Low moisture alert threshold (0–100%)
      --upper-threshold <pct>      Overwatering alert threshold (0–100%)

    Examples:
      npm run update -- 1 --name "Monstera Deliciosa"
      npm run update -- 1 --species "Monstera deliciosa"
      npm run update -- 1 --interval 10 --threshold 25
      npm run update -- 1 --upper-threshold 80
      npm run update -- 1 --notes "Moved to south window"
`,
  device: `
  device <subcommand>
    Manage sensor device → plant assignments. Readings from hardware devices
    are matched to plants using this registry — no plant ID needed on the device.

    Subcommands:
      assign <device-id> <plant-id>   Map a device to a plant
      unassign <device-id>            Remove a device mapping
      list                            Show all device assignments

    Options (assign):
      -n, --name <name>   Optional label for this device

    Examples:
      npm run device -- assign living-room 1
      npm run device -- assign living-room 1 --name "Monstera sensor"
      npm run device -- unassign living-room
      npm run device -- list
`,
  channel: `
  channel <subcommand>
    Manage BBB sensor channel → name mappings from the Mac.
    Mappings are saved locally and published to the device via MQTT (retained).
    The BBB hot-reloads immediately — no restart or SSH required.

    Subcommands:
      map <device-id> <channel> <sensor-name>   Map a mux channel to a sensor name
      unmap <device-id> <channel>               Remove a channel mapping
      list [device-id]                          Show all mappings

    Examples:
      npm run channel -- map living-room 0 monstera
      npm run channel -- map living-room 1 basil
      npm run channel -- unmap living-room 2
      npm run channel -- list
      npm run channel -- list living-room
`,
  serve: `
  serve
    Start the MQTT subscriber. Connects to the Mosquitto broker and listens for
    soil moisture readings published by hardware sensors (BeagleBone, Pi, ESP32).
    Readings are stored in the database. Set MQTT_NOTIFY=true in .env to fire a
    desktop notification when moisture drops below a plant's threshold.

    Environment variables (set in .env):
      MQTT_HOST       Broker hostname or IP (default: localhost)
      MQTT_PORT       Broker port (default: 1883)
      MQTT_USERNAME   Broker username (optional)
      MQTT_PASSWORD   Broker password (optional)
      MQTT_NOTIFY     Fire notifications on low or high moisture: true | false

    Examples:
      npm run serve

    Broker setup:
      docker compose up -d
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
  update    Update a plant's name, species, notes, or care settings
  log       Log a care event (water / feed / repot)
  sensor    Manage soil moisture sensor readings
  device    Manage sensor device → plant assignments
  channel   Manage BBB sensor channel mappings from the Mac
  serve     Start the MQTT subscriber (listen for hardware sensor readings)
  remind    List plants overdue for watering
  remove    Remove a plant from your collection
  status    List your collection or view a plant's health history
  identify  Identify a plant from a photo (requires API keys)
  diagnose  Assess plant health from a photo (requires API keys)
  help      Show this help, or detailed help for a command

Run "npm run help -- <command>" for usage examples.

  npm run help -- add
  npm run help -- update
  npm run help -- log
  npm run help -- sensor
  npm run help -- device
  npm run help -- channel
  npm run help -- serve
  npm run help -- remind
  npm run help -- remove
  npm run help -- status
  npm run help -- identify
  npm run help -- diagnose
`);
  });

program
  .command('serve')
  .description('Start the MQTT subscriber — listens for sensor readings and stores them')
  .action(() => {
    startSubscriber();
  });

program.parse(process.argv);
