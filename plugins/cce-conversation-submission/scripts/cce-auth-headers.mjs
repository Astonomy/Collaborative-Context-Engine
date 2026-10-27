import { pathToFileURL } from "node:url";
export function readAuthorizationHeader(environment = process.env) {
  const token = environment.CCE_MCP_ACCESS_TOKEN;
  if (typeof token !== "string" || !/^[^\s]+$/u.test(token)) {
    throw new Error("CCE_MCP_ACCESS_TOKEN must be set in the client process environment.");
  }
  return `Bearer ${token}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify({ Authorization: readAuthorizationHeader() }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
