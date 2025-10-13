// src/utils/response.js - Standardized API Response Helpers
import logger from '../config/logger.js';

/**
 * Send success response
 * 
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} JSON response
 */
export const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
  // Log successful response
  logger.info('Success Response', {
    statusCode,
    message,
    dataType: typeof data,
    hasData: !!data
  });

  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

/**
 * Send error response
 * 
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} errors - Additional error details (optional)
 * @returns {Object} JSON response
 */
export const sendError = (res, message = 'Something went wrong', statusCode = 500, errors = null) => {
  // Log error response
  logger.error('Error Response', {
    statusCode,
    message,
    errors
  });

  const response = {
    success: false,
    message
  };

  // Add errors if provided
  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send paginated response
 * 
 * @param {Object} res - Express response object
 * @param {Array} data - Array of data
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} total - Total number of items
 * @param {string} message - Success message
 * @returns {Object} JSON response with pagination
 */
export const sendPaginatedResponse = (res, data, page, limit, total, message = 'Success') => {
  const totalPages = Math.ceil(total / limit);
  
  logger.info('Paginated Response', {
    page,
    limit,
    total,
    totalPages,
    itemsReturned: data.length
  });

  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      currentPage: parseInt(page),
      itemsPerPage: parseInt(limit),
      totalItems: total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    }
  });
};

/**
 * Send created response (for POST requests)
 * 
 * @param {Object} res - Express response object
 * @param {*} data - Created resource data
 * @param {string} message - Success message
 * @returns {Object} JSON response with 201 status
 */
export const sendCreated = (res, data, message = 'Resource created successfully') => {
  return sendSuccess(res, data, message, 201);
};

/**
 * Send no content response (for DELETE requests)
 * 
 * @param {Object} res - Express response object
 * @returns {Object} Empty response with 204 status
 */
export const sendNoContent = (res) => {
  logger.info('No Content Response - 204');
  return res.status(204).send();
};

export default {
  sendSuccess,
  sendError,
  sendPaginatedResponse,
  sendCreated,
  sendNoContent
};