import dotenv from 'dotenv';
import logger from './logger.js';

// Load environment variables from .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'MONGO_URI'];

const missingEnvVars = requiredEnvVars.filter(env => !process.env[env]);

if (missingEnvVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// Export validated environment variables
export const ENV = {
  JWT_SECRET: process.env.JWT_SECRET?.trim(),
  JWT_EXPIRE: process.env.JWT_EXPIRE || '30d',
  MONGO_URI: process.env.MONGO_URI,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
};

export default ENV;
