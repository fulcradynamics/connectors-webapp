import { start, getRun } from 'workflow/api';
import { dependencyCanary } from '../../../workflows/canary.js';
export async function POST() {
  const run = await start(dependencyCanary, ['dependency-fixture']);
  return Response.json({ runId: run.runId });
}
export async function GET({ url }) {
  const run = getRun(url.searchParams.get('runId'));
  return Response.json({ status: await run.status, output: await run.returnValue });
}
