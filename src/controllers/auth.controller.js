// src/controllers/auth.controller.js - Clean Authentication Controller
import User from '../models/User.js';
import { sendSuccess } from '../utils/response.js';
import { generateToken, setTokenCookie, clearTokenCookie } from '../middleware/auth.middleware.js';
import { catchAsync } from '../utils/catchAsync.js';
import { NotFoundError, BadRequestError, TooManyRequestsError } from '../utils/customError.js';
import { maskPhoneNumber, maskEmail } from '../utils/helpers.js';
import logger from '../config/logger.js';
import { sendOTPNotification } from '../utils/sendOtp.js';

/**
 * @desc    Send OTP to phone number
 * @route   POST /api/auth/send-otp
 * @access  Public
 */
export const sendOtp = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  logger.info('OTP request received', { 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  // Find existing user
  let user = await User.findOne({ phoneNumber }).select('+otp');
  
  if (!user) {
    // Create temporary user for OTP
    user = new User({ phoneNumber });
    logger.info('New user created for OTP', { 
      phoneNumber: maskPhoneNumber(phoneNumber) 
    });
  } else {
    // Check rate limiting for existing users
    const { canRequest, waitTime } = user.canRequestOTP();
    
    if (!canRequest) {
      logger.warn('OTP request rate limited', { 
        phoneNumber: maskPhoneNumber(phoneNumber),
        waitTime 
      });
      throw new TooManyRequestsError(
        `Please wait ${waitTime} seconds before requesting a new OTP`
      );
    }
  }

  // Generate and save OTP
  const otp = user.generateOTP();
  await user.save({ validateBeforeSave: false });

  logger.info('OTP generated successfully', { 
    phoneNumber: maskPhoneNumber(phoneNumber),
    expiresAt: user.otp.expiresAt
  });

  // Send push notification (non-blocking)
  if (fcmToken) {
    sendOTPNotification(fcmToken, otp)
      .then(() => {
        logger.info('OTP notification sent successfully', { 
          phoneNumber: maskPhoneNumber(phoneNumber) 
        });
      })
      .catch((error) => {
        logger.error('Failed to send OTP notification', { 
          phoneNumber: maskPhoneNumber(phoneNumber),
          error: error.message 
        });
        // Don't throw error - notification failure shouldn't block OTP sending
      });
  }

  // Prepare response
  const responseData = {
    phoneNumber: maskPhoneNumber(phoneNumber),
    message: 'OTP sent successfully',
    expiresIn: '10 minutes'
  };

  // Include OTP in development mode only
  if (process.env.NODE_ENV === 'development') {
    responseData.otp = otp;
    responseData.message = 'OTP sent successfully (Dev mode: OTP included)';
  }

  return sendSuccess(res, responseData, 'OTP sent successfully', 200);
});

/**
 * @desc    Verify OTP
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
export const verifyOtp = catchAsync(async (req, res) => {
  const { phoneNumber, otp } = req.body;

  logger.info('OTP verification attempt', { 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  // Find user with OTP data
  const user = await User.findOne({ phoneNumber }).select('+otp');

  if (!user) {
    logger.warn('Verification failed - user not found', { 
      phoneNumber: maskPhoneNumber(phoneNumber) 
    });
    throw new NotFoundError('User not found. Please request OTP first.');
  }

  // Verify OTP
  const isOTPValid = user.verifyOTP(otp);

  if (!isOTPValid) {
    // Save failed attempt
    await user.save({ validateBeforeSave: false });
    
    const attemptsLeft = 3 - (user.otp?.attempts || 0);
    
    logger.warn('OTP verification failed', { 
      phoneNumber: maskPhoneNumber(phoneNumber),
      attempts: user.otp?.attempts || 0,
      attemptsLeft
    });

    // Check if max attempts exceeded
    if (user.otp && user.otp.attempts >= 3) {
      user.clearOTP();
      await user.save({ validateBeforeSave: false });
      throw new BadRequestError(
        'Maximum OTP attempts exceeded. Please request a new OTP.'
      );
    }

    throw new BadRequestError(
      `Invalid or expired OTP. ${attemptsLeft} attempt(s) remaining.`
    );
  }

  // OTP verified successfully
  user.isVerified = true;
  user.clearOTP();
  await user.save({ validateBeforeSave: false });

  logger.info('OTP verified successfully', { 
    userId: user._id,
    phoneNumber: maskPhoneNumber(phoneNumber),
    isNewUser: !user.name // Check if user needs to complete registration
  });

  // Generate JWT token
  const token = generateToken(user._id);

  // Set cookie if enabled
  if (process.env.USE_COOKIES === 'true') {
    setTokenCookie(res, token);
  }

  // Prepare user data
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    isVerified: user.isVerified,
    role: user.role,
    needsRegistration: !user.name, // Flag to indicate if user needs to complete profile
    createdAt: user.createdAt
  };

  return sendSuccess(
    res,
    {
      accessToken: token,
      user: userData,
      expiresIn: '30 days'
    },
    'OTP verified successfully',
    200
  );
});

/**
 * @desc    Register/Complete user profile after OTP verification
 * @route   POST /api/auth/register
 * @access  Private (requires valid token from verifyOtp)
 */
export const register = catchAsync(async (req, res) => {
  const { name, email, address, preferences } = req.body;

  logger.info('User registration attempt', { 
    userId: req.user._id 
  });

  // Find user
  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check if user is verified
  if (!user.isVerified) {
    throw new BadRequestError('Please verify your phone number first');
  }

  // Check if email already exists (if provided)
  if (email) {
    const existingEmail = await User.findOne({ 
      email, 
      _id: { $ne: user._id } 
    });
    
    if (existingEmail) {
      throw new BadRequestError('This email is already registered');
    }
  }

  // Update user profile
  user.name = name;
  if (email) user.email = email;
  if (address) user.address = { ...user.address, ...address };
  if (preferences) user.preferences = { ...user.preferences, ...preferences };

  await user.save();
  await user.updateLastLogin();

  logger.info('User registration completed', { 
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Prepare complete user data
  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    isVerified: user.isVerified,
    isActive: user.isActive,
    role: user.role,
    profilePicture: user.profilePicture,
    address: user.address,
    preferences: user.preferences,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'Registration completed successfully',
    201
  );
});

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/user
 * @access  Private
 */
export const getUser = catchAsync(async (req, res) => {
  logger.info('Fetching user profile', { 
    userId: req.user._id 
  });

  // Prepare user data (req.user is attached by protect middleware)
  const userData = {
    id: req.user._id,
    phoneNumber: req.user.phoneNumber,
    name: req.user.name,
    email: req.user.email,
    isVerified: req.user.isVerified,
    isActive: req.user.isActive,
    role: req.user.role,
    profilePicture: req.user.profilePicture,
    address: req.user.address,
    preferences: req.user.preferences,
    lastLogin: req.user.lastLogin,
    createdAt: req.user.createdAt,
    updatedAt: req.user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'User profile retrieved successfully',
    200
  );
});

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = catchAsync(async (req, res) => {
  const { name, email, address, preferences } = req.body;

  logger.info('Profile update attempt', { 
    userId: req.user._id 
  });

  const user = await User.findById(req.user._id);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Check if email is being changed and already exists
  if (email && email !== user.email) {
    const existingEmail = await User.findOne({ 
      email, 
      _id: { $ne: user._id } 
    });
    
    if (existingEmail) {
      throw new BadRequestError('This email is already registered');
    }
  }

  // Update fields if provided
  if (name) user.name = name;
  if (email) user.email = email;
  if (address) user.address = { ...user.address, ...address };
  if (preferences) user.preferences = { ...user.preferences, ...preferences };

  await user.save();

  logger.info('Profile updated successfully', { 
    userId: user._id,
    updatedFields: {
      name: !!name,
      email: !!email,
      address: !!address,
      preferences: !!preferences
    }
  });

  const userData = {
    id: user._id,
    phoneNumber: user.phoneNumber,
    name: user.name,
    email: user.email ? maskEmail(user.email) : null,
    address: user.address,
    preferences: user.preferences,
    updatedAt: user.updatedAt
  };

  return sendSuccess(
    res,
    userData,
    'Profile updated successfully',
    200
  );
});

/**
 * @desc    Resend OTP
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
export const resendOtp = catchAsync(async (req, res) => {
  const { phoneNumber, fcmToken } = req.body;

  logger.info('OTP resend request', { 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  const user = await User.findOne({ phoneNumber }).select('+otp');

  if (!user) {
    throw new NotFoundError('User not found. Please request OTP first.');
  }

  // Check rate limiting
  const { canRequest, waitTime } = user.canRequestOTP();
  
  if (!canRequest) {
    logger.warn('OTP resend rate limited', { 
      phoneNumber: maskPhoneNumber(phoneNumber),
      waitTime 
    });
    throw new TooManyRequestsError(
      `Please wait ${waitTime} seconds before requesting a new OTP`
    );
  }

  // Generate new OTP
  const otp = user.generateOTP();
  await user.save({ validateBeforeSave: false });

  logger.info('OTP resent successfully', { 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  // Send push notification (non-blocking)
  if (fcmToken) {
    sendOTPNotification(fcmToken, otp).catch((error) => {
      logger.error('Failed to send OTP notification', { 
        error: error.message 
      });
    });
  }

  // Prepare response
  const responseData = {
    phoneNumber: maskPhoneNumber(phoneNumber),
    message: 'OTP resent successfully',
    expiresIn: '10 minutes'
  };

  // Include OTP in development mode
  if (process.env.NODE_ENV === 'development') {
    responseData.otp = otp;
  }

  return sendSuccess(res, responseData, 'OTP resent successfully', 200);
});

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = catchAsync(async (req, res) => {
  logger.info('User logout', { 
    userId: req.user._id 
  });

  // Clear cookie if using cookies
  if (process.env.USE_COOKIES === 'true') {
    clearTokenCookie(res);
  }

  return sendSuccess(res, null, 'Logged out successfully', 200);
});

/**
 * @desc    Delete user account (soft delete)
 * @route   DELETE /api/auth/account
 * @access  Private
 */
export const deleteAccount = catchAsync(async (req, res) => {
  const { confirmPhoneNumber } = req.body;

  logger.info('Account deletion request', { 
    userId: req.user._id 
  });

  // Verify phone number matches for safety
  if (confirmPhoneNumber !== req.user.phoneNumber) {
    throw new BadRequestError('Phone number confirmation does not match');
  }

  const user = await User.findById(req.user._id);
  
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Soft delete (set isActive to false)
  user.isActive = false;
  await user.save();

  logger.warn('User account deleted', { 
    userId: user._id,
    phoneNumber: maskPhoneNumber(user.phoneNumber)
  });

  // Clear authentication
  clearTokenCookie(res);

  return sendSuccess(res, null, 'Account deleted successfully', 200);
});

/**
 * @desc    Check if phone number exists
 * @route   POST /api/auth/check-phone
 * @access  Public
 */
export const checkPhoneExists = catchAsync(async (req, res) => {
  const { phoneNumber } = req.body;

  logger.info('Phone number check', { 
    phoneNumber: maskPhoneNumber(phoneNumber) 
  });

  const user = await User.findOne({ phoneNumber });

  return sendSuccess(
    res,
    {
      exists: !!user,
      isVerified: user?.isVerified || false,
      isRegistered: user?.name ? true : false
    },
    'Phone number check completed',
    200
  );
});

// Export all functions
export default {
  sendOtp,
  verifyOtp,
  register,
  getUser,
  updateProfile,
  resendOtp,
  logout,
  deleteAccount,
  checkPhoneExists
};