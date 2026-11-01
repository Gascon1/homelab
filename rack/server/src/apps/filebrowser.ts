import type { App } from './types.ts';

/** Listed in the dashboard, but File Browser has no stats API worth reading. */
export const filebrowser: App = {
  id: 'filebrowser',
  match: ['filebrowser'],
  name: 'File Browser',
  group: 'Files',
  icon: 'filebrowser',
  port: 80,
  widget: null,
};
