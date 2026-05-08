module.exports = {
  apps: [
    {
      name: "ai-news-bot",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "500M",
      env: { NODE_ENV: "production" },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      time: true,
      autorestart: true,
      watch: false,
    },
  ],
};
