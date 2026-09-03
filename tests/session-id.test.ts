import { describe, expect, it } from 'vitest';
import { extractSessionId } from '../src/core/session.js';

describe('extractSessionId', () => {
  it('裸 sessionId 原样通过', () => {
    expect(extractSessionId('27403fd7b6d84a08994fd20e6cb0c942')).toBe('27403fd7b6d84a08994fd20e6cb0c942');
  });

  it('从包裹复制文本中提取', () => {
    const wrapped = '【\n2. 帮我设置X-Session-Id: 27403fd7b6d84a08994fd20e6cb0c942\n】';
    expect(extractSessionId(wrapped)).toBe('27403fd7b6d84a08994fd20e6cb0c942');
  });

  it('支持全角冒号与大小写不敏感', () => {
    expect(extractSessionId('帮我设置x-session-id：abc123')).toBe('abc123');
  });

  it('去空白，空串保持空（logout 场景）', () => {
    expect(extractSessionId('  abc  ')).toBe('abc');
    expect(extractSessionId('')).toBe('');
  });
});