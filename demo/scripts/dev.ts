/** @file Loads local demo environment settings and starts the Express server. */
import { existsSync } from 'node:fs';
import process from 'node:process';
import { startDemoServer } from '../src/server.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

startDemoServer();
