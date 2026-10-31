import { createConfig } from "./e2e/config";

/** Production build (`pnpm build && pnpm start -p 3200`): public pages. Run with `pnpm e2e`. */
export default createConfig("prod");
