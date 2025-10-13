// src/middleware/error.middleware.js - Global Error Handler
import logger from '../config/logger.js';
import AppError from '../utils/customError.js';

/**
 * Handle CastError (Invalid MongoDB ObjectId)
 */
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  logger.warn('CastError handled', { path: err.path, value: err.value });
  return new AppError(message, 400);
};

/**
 * Handle Duplicate Field Error (MongoDB 11000 error code)
 */
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `${field} '${value}' already exists. Please use another value.`;
  
  logger.warn('Duplicate field error', { field, value });
  return new AppError(message, 409);
};

/**
 * Handle Mongoose Validation Error
 */
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  
  logger.warn('Validation error', { errors });
  return new AppError(message, 400);
};

/**
 * Handle JWT Invalid Error
 */
const handleJWTError = () => {
  logger.warn('Invalid JWT token');
  return new AppError('Invalid token. Please log in again.', 401);
};

/**
 * Handle JWT Expired Error
 */
const handleJWTExpiredError = () => {
  logger.warn('Expired JWT token');
  return new AppError('Your token has expired. Please log in again.', 401);
};

/**
 * Handle Token Not Before Error
 */
const handleJWTNotBeforeError = () => {
  logger.warn('JWT token not active yet');
  return new AppError('Token not active yet. Please try again later.', 401);
};

/**
 * Handle Mongoose ObjectId Error
 */
const handleObjectIdError = () => {
  logger.warn('Invalid ObjectId format');
  return new AppError('Invalid ID format', 400);
};

/**
 * Send Error Response in Development Mode
 * Includes detailed error information for debugging
 */
const sendErrorDev = (err, req, res) => {
  // Log comprehensive error details
  logger.error('ERROR 💥 [Development]', {
    error: {
      message: err.message,
      name: err.name,
      statusCode: err.statusCode,
      stack: err.stack
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: req.body,
      params: req.params,
      query: req.query
    },
    user: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString()
  });

  // Send detailed error response
  res.status(err.statusCode || 500).json({
    success: false,
    status: err.status || 'error',
    error: {
      message: err.message,
      name: err.name,
      statusCode: err.statusCode,
      isOperational: err.isOperational
    },
    message: err.message,
    stack: err.stack,
    request: {
      method: req.method,
      url: req.originalUrl
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Send Error Response in Production Mode
 * Minimal error information for security
 */
const sendErrorProd = (err, req, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    logger.error('Operational Error [Production]', {
      message: err.message,
      statusCode: err.statusCode,
      url: req.originalUrl,
      method: req.method,
      user: req.user?.id || 'anonymous',
      timestamp: new Date().toISOString()
    });

    res.status(err.statusCode).json({
      success: false,
      status: err.status,
      message: err.message
    });
  } 
  // Programming or unknown error: don't leak error details
  else {
    logger.error('UNKNOWN ERROR 💥 [Production]', {
      error: {
        message: err.message,
        name: err.name,
        stack: err.stack
      },
      request: {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      },
      timestamp: new Date().toISOString()
    });

    // Send generic error message
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Something went wrong. Please try again later.'
    });
  }
};

/**
 * Global Error Handler Middleware
 * Central error handling for the entire application
 */
export const globalErrorHandler = (err, req, res, next) => {
  // Set default values
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log the error occurrence
  logger.error('Error caught by global handler', {
    errorName: err.name,
    errorMessage: err.message,
    statusCode: err.statusCode,
    url: req.originalUrl
  });

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else if (process.env.NODE_ENV === 'production') {
    let error = Object.create(err);
    error.message = err.message;
    error.name = err.name;
    error.statusCode = err.statusCode;
    error.status = err.status;
    error.isOperational = err.isOperational;

    // Handle specific error types
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.name === 'NotBeforeError') error = handleJWTNotBeforeError();
    if (error.message && error.message.includes('ObjectId')) error = handleObjectIdError();

    sendErrorProd(error, req, res);
  }
};

/**
 * Handle 404 Not Found Errors
 * Middleware to catch requests to undefined routes
 */
export const notFoundHandler = (req, res, next) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  const err = new AppError(`Cannot find ${req.originalUrl} on this server`, 404);
  next(err);
};

/**
 * Handle Unhandled Routes
 * Alternative handler for 404 errors
 */
export const handleUnhandledRoutes = (req, res, next) => {
  logger.warn('Unhandled route accessed', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  const message = `Route ${req.method} ${req.originalUrl} not found`;
  next(new AppError(message, 404));
};

/**
 * Async Error Handler Wrapper
 * Already exists in catchAsync.js but included here for reference
 */
export const asyncErrorHandler = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

export default globalErrorHandler;