import { app } from './state.js';
/** Media paths are stored as /media/<file>; exported tours serve them relative to index.html. */
export const mediaUrl = path => (app.isStatic ? path.replace(/^\//, '') : path);
