import "dotenv-defaults/config";
import { main } from "./main";

const EVERY_MS = 5 * 60 * 1000;

async function runOnce() {
  const at = new Date().toISOString();
  try {
    const result = await main();
    console.log(`[${at}] done — verified=${result.verified}`);
  } catch (err) {
    console.error(`[${at}] failed:`, err);
  } finally {
    setTimeout(runOnce, EVERY_MS); // schedule the NEXT run only after this one finishes
  }
}

runOnce();