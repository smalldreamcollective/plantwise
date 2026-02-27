import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as child_process from 'child_process';

// Mock execSync before importing notify
vi.mock('child_process', () => ({ execSync: vi.fn() }));

import { notify } from './notify';

describe('notify', () => {
  const execSyncMock = vi.mocked(child_process.execSync);

  beforeEach(() => {
    execSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls osascript with the message body and title', () => {
    notify('Basil needs water — never watered');
    expect(execSyncMock).toHaveBeenCalledOnce();
    const cmd = execSyncMock.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('display notification');
    expect(cmd).toContain('Basil needs water — never watered');
    expect(cmd).toContain('PlantWise');
  });

  it('escapes double quotes in the body', () => {
    notify('Say "hello"');
    const cmd = execSyncMock.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('\\"hello\\"');
  });

  it('escapes backslashes in the body', () => {
    notify('path\\to\\file');
    const cmd = execSyncMock.mock.calls[0]?.[0] as string;
    expect(cmd).toContain('path\\\\to\\\\file');
  });

  it('does not throw when execSync fails', () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('osascript not found');
    });
    expect(() => notify('test')).not.toThrow();
  });
});
