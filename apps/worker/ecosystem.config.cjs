// pm2: `pm2 start apps/worker/ecosystem.config.cjs` from the repo root, then `pm2 save`.
module.exports = {
  apps: [
    {
      name: "deal-hunter",
      cwd: __dirname,
      script: "pm2.mjs",
      node_args: ["--import", "tsx"],
      // Windows has no SIGTERM: pm2 sends a "shutdown" message instead, so the worker can close Edge.
      shutdown_with_message: true,
      kill_timeout: 10000,
      exp_backoff_restart_delay: 5000,
    },
  ],
};
