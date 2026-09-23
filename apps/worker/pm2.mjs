// pm2 entry point: pm2 require()s .ts files, which breaks top-level await, but import()s .mjs ones.
import "./src/main.ts";
