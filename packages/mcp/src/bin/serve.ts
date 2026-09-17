import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStore } from '@reconcile/store';
import { createReconcileServer } from '../index.js';

const projectArg = process.argv.indexOf('--project');
const projectId = projectArg >= 0 ? process.argv[projectArg + 1] : 'default';

const store = createStore();
await store.migrate();
const server = createReconcileServer(store, projectId);
await server.connect(new StdioServerTransport());
