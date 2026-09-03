import { Command } from 'commander';
import { createRequire } from 'node:module';
import { AnycliError, ExitCode, setProfileOverride } from './core/index.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerSkillCommands } from './commands/skill.js';
import { registerGenCommands } from './commands/gen.js';
import { registerRequestCommands } from './commands/request.js';
import { registerFlowCommands, registerFlowVersionCommands } from './commands/flow.js';
import { registerEditCommands } from './commands/edit.js';
import { registerInitCommands } from './commands/init.js';
import { registerSkillBuildCommands } from './commands/skill-build.js';
import { registerDiscoveredProjects } from './core/discovery.js';
import { registerFlowEnhanceCommands } from './core/flow-enhance-cli.js';

const packageJson = createRequire(import.meta.url)('../package.json') as { version: string };
const program = new Command();

program
  .name('anycli')
  .description('anycli - 通用 Agent-Friendly CLI：系统CLI化、流程Skill化')
  .version(packageJson.version)
  .option('--format <format>', '输出格式: json | table | text', 'json')
  .option('--env <env>', '环境: test | prod | dev')
  .option('--profile <name>', '指定 Profile（多环境/多租户隔离）')
  .option('--non-interactive', '非交互模式，禁止所有提示')
  .option('--quiet', '静默模式，只输出核心数据')
  .option('--verbose', '调试模式，打印请求日志')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      setProfileOverride(opts.profile);
    }
    if (opts.env) {
      process.env.ANYCLI_ENV = opts.env;
    }
  });

registerAuthCommands(program);
registerConfigCommands(program);
registerRequestCommands(program);
registerSkillCommands(program);
registerSkillBuildCommands(program);
registerGenCommands(program);
registerFlowCommands(program);
registerFlowVersionCommands(program);
registerFlowEnhanceCommands(program, process.cwd());
registerEditCommands(program);
registerInitCommands(program);

registerDiscoveredProjects(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof AnycliError) {
    console.error(JSON.stringify(error.toJSON(), null, 2));
    process.exit(error.exitCode);
  }
  console.error(JSON.stringify({
    success: false,
    error: {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    },
  }, null, 2));
  process.exit(ExitCode.GENERAL_ERROR);
});
