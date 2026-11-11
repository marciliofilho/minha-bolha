/** CLI: `npm run seed` — recria os dados de demonstração. */
import { db } from '../db/database';
import { deleteDemoSources } from '../db/repositories/sources';
import { seedDemoData } from '../seed';

const removed = deleteDemoSources();
const result = seedDemoData(true);
console.log(JSON.stringify({ removed, ...result }, null, 2));
db.close();
