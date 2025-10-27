// src/models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs'; // Reserved for future use (password hashing if needed)
// Use namespace import with safe fallback
import * as constants from '../config/constants.js';

// OTP configuration (fallback if constants missing)
const OTP_CONFIG = constants.OTP_CONFIG || {
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 3,
  RESEND_TIMEOUT_SECONDS: 60
};

// ---------------------- Schema Definition ----------------------

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true, // Creates a unique index automatically
    trim: true,
    match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian phone number']
  },
  name: {
    type: String,
    trim: true,
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  otp: {
    code: {
      type: String,
      select: false // Exclude OTP fields in default queries
    },
    expiresAt: {
      type: Date,
      select: false
    },
    attempts: {
      type: Number,
      default: 0,
      select: false
    },
    lastRequestedAt: {
      type: Date,
      select: false
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['CUSTOMER', 'DRIVER', 'ADMIN'],
    default: 'CUSTOMER'
  },
  profilePicture: {
    type: String,
    default: null
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: {
      type: String,
      default: 'India'
    }
  },
  preferences: {
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en'
    },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    }
  },
  lastLogin: {
    type: Date
  },
  deviceInfo: [{
    deviceId: String,
    deviceType: String,
    fcmToken: String,
    lastUsed: Date
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ---------------------- Indexes ----------------------

// ✅ Removed duplicate phoneNumber index (unique already handles it)
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ createdAt: -1 });

// ---------------------- Virtuals ----------------------

userSchema.virtual('fullName').get(function() {
  return this.name || 'User';
});

userSchema.virtual('maskedPhone').get(function() {
  if (!this.phoneNumber) return '';
  return 'XXXXXX' + this.phoneNumber.slice(-4);
});

// ---------------------- Instance Methods ----------------------

/**
 * Generate and assign OTP
 * @returns {string} Generated OTP
 */
userSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiryMinutes = OTP_CONFIG.EXPIRY_MINUTES || 10;

  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
    attempts: 0,
    lastRequestedAt: new Date()
  };

  return otp;
};

/**
 * Verify OTP
 * @param {string} inputOTP
 * @returns {boolean}
 */
userSchema.methods.verifyOTP = function(inputOTP) {
  if (!this.otp || !this.otp.code) return false;
  if (new Date() > this.otp.expiresAt) return false;
  if (this.otp.attempts >= (OTP_CONFIG.MAX_ATTEMPTS || 3)) return false;

  this.otp.attempts += 1;
  return this.otp.code === inputOTP;
};

/**
 * Clear OTP fields
 */
userSchema.methods.clearOTP = function() {
  this.otp = undefined;
};

/**
 * Check if user can request new OTP
 * @returns {{canRequest: boolean, waitTime: number}}
 */
userSchema.methods.canRequestOTP = function() {
  if (!this.otp || !this.otp.lastRequestedAt) {
    return { canRequest: true, waitTime: 0 };
  }

  const timeoutSeconds = OTP_CONFIG.RESEND_TIMEOUT_SECONDS || 60;
  const timeSinceLastRequest = (Date.now() - this.otp.lastRequestedAt.getTime()) / 1000;
  const waitTime = Math.max(0, timeoutSeconds - timeSinceLastRequest);

  return {
    canRequest: waitTime === 0,
    waitTime: Math.ceil(waitTime)
  };
};

/**
 * Update last login timestamp
 */
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

/**
 * Add or update device info
 * @param {Object} deviceInfo
 */
userSchema.methods.addDevice = function(deviceInfo) {
  const existingDevice = this.deviceInfo.find(d => d.deviceId === deviceInfo.deviceId);

  if (existingDevice) {
    existingDevice.lastUsed = new Date();
    existingDevice.fcmToken = deviceInfo.fcmToken || existingDevice.fcmToken;
  } else {
    this.deviceInfo.push({
      ...deviceInfo,
      lastUsed: new Date()
    });
  }

  return this.save({ validateBeforeSave: false });
};

// ---------------------- Middleware ----------------------

userSchema.pre('save', async function(next) {
  // Future use: hash OTP or other sensitive data if needed
  next();
});

userSchema.pre(/^find/, function(next) {
  // Optionally exclude inactive users globally
  // this.find({ isActive: { $ne: false } });
  next();
});

// ---------------------- Static Methods ----------------------

/**
 * Find user by phone number
 */
userSchema.statics.findByPhoneNumber = function(phoneNumber) {
  return this.findOne({ phoneNumber });
};

/**
 * Find all verified active users
 */
userSchema.statics.findVerified = function() {
  return this.find({ isVerified: true, isActive: true });
};

/**
 * Count total active users
 */
userSchema.statics.countActive = function() {
  return this.countDocuments({ isActive: true });
};

// ---------------------- Model Export ----------------------

const User = mongoose.model('User', userSchema);

export default User;