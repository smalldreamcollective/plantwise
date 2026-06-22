import { execFileSync } from 'child_process';

const TITLE = 'PlantWise';

export function notify(body: string): void {
  try {
    const safe = body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `display notification "${safe}" with title "${TITLE}"`;
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch {
    // Notification failure must never crash the CLI
  }
}
