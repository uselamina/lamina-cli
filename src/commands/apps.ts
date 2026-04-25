import { parseArgs } from 'node:util';

import { createClientFromAuthContext } from '../lib/config.js';
import { printAppDetail, printAppList, printJson, printWorkflow } from '../lib/output.js';

export async function handleAppsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'list') {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        search: { type: 'string' },
        limit: { type: 'string' },
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: false,
    });

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });
    const response = await client.apps.list({
      search: parsed.values.search,
      limit: parsed.values.limit ? Number.parseInt(parsed.values.limit, 10) : undefined,
    });

    if (parsed.values.json) {
      printJson(response);
      return;
    }

    printAppList(response.data);
    return;
  }

  if (subcommand === 'get' || subcommand === 'workflow') {
    const appId = args[1];
    if (!appId) {
      throw new Error(`Missing appId. Use \`lamina apps ${subcommand} <appId>\`.`);
    }

    const parsed = parseArgs({
      args: args.slice(2),
      options: {
        json: { type: 'boolean' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
      },
      allowPositionals: false,
    });

    const { client } = await createClientFromAuthContext({
      apiKey: parsed.values['api-key'],
      baseUrl: parsed.values['base-url'],
    });

    if (subcommand === 'get') {
      const response = await client.apps.get(appId);
      if (parsed.values.json) {
        printJson(response);
      } else {
        printAppDetail(response.data);
      }
      return;
    }

    const response = await client.apps.workflow(appId);
    if (parsed.values.json) {
      printJson(response);
    } else {
      printWorkflow(response.data);
    }
    return;
  }

  throw new Error('Unknown apps command. Use `lamina apps list`, `get`, or `workflow`.');
}
