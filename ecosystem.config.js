// PM2 Ecosystem Configuration
// Start dev:  pm2 start ecosystem.config.js --only innovate-hub-dev
// Start prod: pm2 start ecosystem.config.js --only innovate-hub-prod
// Start all:  pm2 start ecosystem.config.js

module.exports = {
  apps: [
    // ========================================
    // DEVELOPMENT - Single instance, watch mode
    // ========================================
    {
      name: 'innovate-hub-dev',
      script: 'server.js',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: ['server.js', 'routes/', 'middleware/', 'config/', 'services/'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'uploads', 'database', 'public', '*.db', '*.log'],
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000
    },

    // ========================================
    // PRODUCTION - Clustered, no watch
    // ========================================
    {
      name: 'innovate-hub-prod',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 'max',       // Use all CPU cores
      exec_mode: 'cluster',   // Cluster mode for load balancing
      autorestart: true,
      max_restarts: 15,
      restart_delay: 5000,
      max_memory_restart: '512M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/prod-error.log',
      out_file: './logs/prod-out.log',
      merge_logs: true,
      log_type: 'json',

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true
    },

    // ========================================
    // ML SERVICE - Python Flask (optional)
    // ========================================
    {
      name: 'ml-service-dev',
      script: 'ml-service/app.py',
      interpreter: 'python3',
      env: {
        FLASK_ENV: 'development',
        PORT: 5000
      },
      watch: ['ml-service/'],
      ignore_watch: ['__pycache__', '*.pyc'],
      instances: 1,
      autorestart: true,
      max_restarts: 5
    },
    {
      name: 'ml-service-prod',
      script: 'node_modules/.bin/gunicorn',  // Use gunicorn wrapper
      interpreter: 'none',
      args: '--chdir ml-service -w 4 -b 0.0.0.0:5000 app:app --access-logfile - --error-logfile ./logs/ml-error.log',
      cwd: './',
      env: {
        FLASK_ENV: 'production',
        PORT: 5000
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: './logs/ml-prod-error.log',
      out_file: './logs/ml-prod-out.log'
    }
  ]
};
