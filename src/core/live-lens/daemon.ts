/**
 * 本地 CLI Live Lens Daemon 监听服务器 (127.0.0.1:19877)
 */

import http from 'http';
import { sanitizeNetworkLogs } from './sanitizer.js';
import { inferValueFlowDependencies } from './value-flow-engine.js';
import { generateLiveLensFlow } from './flow-generator.js';

export interface DaemonServerOptions {
  port?: number;
  project: string;
  business: string;
  token?: string;
  gatewayUrl?: string;
  projectPrefix?: string;
  onSuccess?: (res: { flowJsonPath: string; skillMdPath: string; stepCount?: number }) => void;

}

export function startLiveLensDaemon(options: DaemonServerOptions): http.Server {
  const port = options.port || 19877;
  const host = '127.0.0.1'; // 显式仅绑定环回口，提升安全性

  const server = http.createServer((req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Anycli-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/upload') {
      let bodyData = '';
      req.on('data', (chunk) => {
        bodyData += chunk;
      });

      req.on('end', () => {
        try {
          const payload = JSON.parse(bodyData);

          // 校验 Token（如果设置了的话）
          if (options.token && payload.token !== options.token) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, reason: 'Token 鉴权失败' }));
            return;
          }

          const rawNetworkLogs = payload.networkLogs || [];
          const clickEvents = payload.clickEvents || [];
          const intentText = payload.intent || '';

          // 1. 本地脱敏清洗
          const sanitizedLogs = sanitizeNetworkLogs(rawNetworkLogs);

          // 2. 本地确定性依赖推导
          const dependencies = inferValueFlowDependencies(sanitizedLogs);

          // 3. 生成 flow.json 与 SKILL.md 产物
          const result = generateLiveLensFlow({
            project: options.project,
            business: options.business,
            networkLogs: sanitizedLogs,
            dependencies,
            intentText,
            clickEvents,
            session: payload.session,
            videoDataUrl: payload.videoDataUrl,
            gatewayUrl: options.gatewayUrl,


            projectPrefix: options.projectPrefix,
          });


          if (options.onSuccess) {
            options.onSuccess({ ...result, stepCount: sanitizedLogs.length });
          }


          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              flowJsonPath: result.flowJsonPath,
              skillMdPath: result.skillMdPath,
              stepCount: sanitizedLogs.length,
            })
          );
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, reason: errorMsg }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, host);
  return server;
}
