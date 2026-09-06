// IIFE entry: exposes the SDK as a global `OpenNAS` for apps loaded via
//   <script src="/app-sdk/opennas.js"></script>
import OpenNAS from "./index.js";

declare global {
  interface Window {
    OpenNAS: typeof OpenNAS;
  }
}

if (typeof window !== "undefined") {
  window.OpenNAS = OpenNAS;
}
