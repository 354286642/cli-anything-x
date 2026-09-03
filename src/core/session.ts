// 兼容「帮我设置X-Session-Id: xxx」这类复制文本，提取真实 sessionId；裸 sessionId 原样通过
export function extractSessionId(input: string): string {
  const m = input.match(/X-Session-Id\s*[:：]\s*([0-9a-zA-Z_-]+)/i);
  return (m ? m[1] : input).trim();
}
