import chalk from 'chalk';
import Table from 'cli-table3';

export type OutputFormat = 'json' | 'table' | 'text';

export function output(data: unknown, format: OutputFormat = 'json'): void {
  switch (format) {
    case 'json':
      outputJson(data);
      break;
    case 'table':
      outputTable(data);
      break;
    case 'text':
      outputText(data);
      break;
  }
}

function outputJson(data: unknown): void {
  const wrapped = {
    success: true,
    data,
  };
  console.log(JSON.stringify(wrapped, null, 2));
}

function outputTable(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(chalk.yellow('（无数据）'));
      return;
    }
    const headers = Object.keys(data[0] as Record<string, unknown>);
    const table = new Table({
      head: headers.map((h) => chalk.cyan(h)),
      style: { head: [], border: [] },
    });
    for (const row of data) {
      table.push(headers.map((h) => String((row as Record<string, unknown>)[h] ?? '')));
    }
    console.log(table.toString());
  } else if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data as Record<string, unknown>);
    const table = new Table({ style: { head: [], border: [] } });
    for (const [key, value] of entries) {
      table.push({ [chalk.cyan(key)]: String(value ?? '') });
    }
    console.log(table.toString());
  } else {
    console.log(String(data));
  }
}

function outputText(data: unknown): void {
  if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data));
  }
}

export function outputError(error: { code: string; message: string; hint?: string }): void {
  const wrapped = {
    success: false,
    error,
  };
  console.error(JSON.stringify(wrapped, null, 2));
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}
