import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as child_process from 'child_process';

// Mock execFileSync before importing notify
vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

import { notify } from './notify';

describe('notify', () => {
  const execFileSyncMock = vi.mocked(child_process.execFileSync);

  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls osascript via execFileSync with the message body and title', () => {
    notify('Basil needs water — never watered');
    expect(execFileSyncMock).toHaveBeenCalledOnce();
    const [cmd, args] = execFileSyncMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('osascript');
    expect(args).toEqual(['-e', expect.stringContaining('display notification')]);
    expect(args[1]).toContain('Basil needs water — never watered');
    expect(args[1]).toContain('PlantWise');
  });

  it('escapes double quotes in the body', () => {
    notify('Say "hello"');
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[];
    expect(args[1]).toContain('\\"hello\\"');
  });

  it('escapes backslashes in the body', () => {
    notify('path\\to\\file');
    const args = execFileSyncMock.mock.calls[0]?.[1] as string[];
    expect(args[1]).toContain('path\\\\to\\\\file');
  });

  it('passes single quotes through as a literal argv element with no shell involved', () => {
    notify("'; touch /tmp/pwned; echo '");
    expect(execFileSyncMock).toHaveBeenCalledOnce();
    const [cmd, args] = execFileSyncMock.mock.calls[0] as [string, string[]];
    // execFileSync never invokes a shell, so the malicious payload is just
    // inert text inside the single -e argv element — no injection possible.
    expect(cmd).toBe('osascript');
    expect(args[1]).toContain("'; touch /tmp/pwned; echo '");
  });

  it('does not throw when execFileSync fails', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('osascript not found');
    });
    expect(() => notify('test')).not.toThrow();
  });
});
