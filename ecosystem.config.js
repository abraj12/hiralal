/**
 * ==============================================================================
 * Hiralal & Sons Rewards Platform - PM2 Production Process Manager Configuration
 * Platform: Hostinger KVM 2 VPS (Ubuntu 24.04/22.04 LTS x86_64)
 * Hardware Budget: 2 vCPU, 8 GB Physical RAM
 * Process Invariants:
 *  - Backend API: Cluster mode (2 instances matching 2 vCPUs), auto-restart, 1GB memory limit
 *  - Worker Daemon: Fork mode (single dedicated processor), BullMQ queue processor, 768MB limit
 *  - Admin Frontend: Fork mode (Next.js server), 768MB limit
 * ==============================================================================
 */

module.exports = {
  apps: [
    {
      name: 'hiralal-backend',
      cwd: './backend',
      script: 'dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1024M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000,
        SERVICE_ROLE: 'api',
      },
      error_file: '/var/log/hiralal/backend-err.log',
      out_file: '/var/log/hiralal/backend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      listen_timeout: 15000,
      exp_backoff_restart_delay: 200,
    },
    {
      name: 'hiralal-worker',
      cwd: './backend',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '768M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
        SERVICE_ROLE: 'worker',
      },
      error_file: '/var/log/hiralal/worker-err.log',
      out_file: '/var/log/hiralal/worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 15000,
      exp_backoff_restart_delay: 500,
    },
    {
      name: 'hiralal-admin',
      cwd: './admin',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '768M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/hiralal/admin-err.log',
      out_file: '/var/log/hiralal/admin-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      exp_backoff_restart_delay: 200,
    },
  ],
};
