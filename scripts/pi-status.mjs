import { createPiRuntime, piStatus } from '../server/pi-service.mjs';
console.log(JSON.stringify(await piStatus(await createPiRuntime()), null, 2));
