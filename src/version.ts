import { version } from '../package.json';

/**
 * The game's version, shown on the title screen. The patch number goes up on every build (`npm run build` and
 * `npm run deploy` run `npm run bump`); bump the major and minor numbers by hand in package.json. A dev server
 * shows the last built version marked `dev`.
 */
export const VERSION = `v${version}${import.meta.env.DEV ? ' dev' : ''}`;
