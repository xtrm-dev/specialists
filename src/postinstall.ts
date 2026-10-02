// npm lifecycle hook: a global install or update (`npm i -g @jaggerxtrm/specialists`)
// registers the bundled native-specialists Pi extension in Pi settings.
// Local/dev installs are ignored. It never fails the install.
// Opt out with SPECIALISTS_SKIP_PI_REGISTRATION=1.

import { registerNativeSpecialists } from './pi/native-specialists-registration.js';

const isGlobal = process.env.npm_config_global === 'true' || process.env.npm_config_location === 'global';

if (isGlobal && process.env.SPECIALISTS_SKIP_PI_REGISTRATION !== '1') {
  try {
    const result = registerNativeSpecialists();
    if (result.status === 'skipped') {
      console.warn(`specialists: Pi extension not registered (${result.reason}); run \`sp init --global\` later.`);
    } else if (result.status !== 'present') {
      console.log(`specialists: native-specialists Pi extension ${result.status} in ${result.settingsPath}`);
    }
  } catch (error) {
    console.warn(`specialists: Pi extension registration failed: ${(error as Error).message}`);
  }
}
