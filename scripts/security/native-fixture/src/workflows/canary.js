export async function dependencyCanary(value) {
  'use workflow';
  return await echo(value);
}
async function echo(value) {
  'use step';
  return value;
}
