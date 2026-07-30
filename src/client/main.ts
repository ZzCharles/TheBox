import "./styles/base.css";
import "./styles/game.css";

import { mountHotseat } from "./ui/hotseat.ts";

/**
 * M2: hot-seat only. M3 adds the lobby and a router in front of this.
 */
const app = document.querySelector<HTMLDivElement>("#app")!;
mountHotseat(app);
