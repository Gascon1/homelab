import { fileURLToPath } from 'node:url';

export interface Env {
  port: number;
  demo: boolean;
  dockerSocket: string;
  configDir: string;
  appdataDir: string;
  procDir: string;
  sysDir: string;
  webDir: string;
  iconCdn: string;
  /** Raw environment, used for RACK_*_API_KEY style secrets. */
  vars: Record<string, string | undefined>;
}

export function loadEnv(vars: Record<string, string | undefined>): Env {
  const port = Number(vars.PORT);
  return {
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 4000,
    demo: vars.RACK_DEMO === '1' || vars.RACK_DEMO === 'true',
    dockerSocket: vars.RACK_DOCKER_SOCKET || '/var/run/docker.sock',
    configDir: vars.RACK_CONFIG_DIR || '/config',
    appdataDir: vars.RACK_APPDATA_DIR || '/appdata',
    procDir: vars.RACK_PROC_DIR || '/proc',
    sysDir: vars.RACK_SYS_DIR || '/sys',
    // Both src/env.ts and dist/server.mjs sit one level below the server package.
    webDir: vars.RACK_WEB_DIR || fileURLToPath(new URL('../../web/dist', import.meta.url)),
    iconCdn: vars.RACK_ICON_CDN || 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons',
    vars,
  };
}
