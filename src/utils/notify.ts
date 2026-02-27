import { execSync } from 'child_process';

const TITLE = 'PlantWise';

export function notify(body: string): void {
  try {
    const safe = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${safe}" with title "${TITLE}"'`, {
      stdio: 'ignore',
    });
  } catch {
    // Notification failure must never crash the CLI
  }
}
