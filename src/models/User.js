// src/models/User.js - Complete User Model
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { OTP_CONFIG } from '../config/constants.js';

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
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
      select: false // Don't include OTP in queries by default
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

// Indexes for better query performance
userSchema.index({ phoneNumber: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return this.name || 'User';
});

// Virtual for masked phone number
userSchema.virtual('maskedPhone').get(function() {
  if (!this.phoneNumber) return '';
  return 'XXXXXX' + this.phoneNumber.slice(-4);
});

/**
 * Instance method to generate OTP
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
 * Instance method to verify OTP
 * @param {string} inputOTP - OTP to verify
 * @returns {boolean} True if OTP is valid
 */
userSchema.methods.verifyOTP = function(inputOTP) {
  // Check if OTP exists
  if (!this.otp || !this.otp.code) {
    return false;
  }

  // Check if OTP has expired
  if (new Date() > this.otp.expiresAt) {
    return false;
  }

  // Check if max attempts exceeded
  if (this.otp.attempts >= (OTP_CONFIG.MAX_ATTEMPTS || 3)) {
    return false;
  }

  // Increment attempts
  this.otp.attempts += 1;

  // Verify OTP
  return this.otp.code === inputOTP;
};

/**
 * Instance method to clear OTP
 */
userSchema.methods.clearOTP = function() {
  this.otp = undefined;
};

/**
 * Instance method to check if user can request OTP
 * @returns {Object} { canRequest: boolean, waitTime: number }
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
 * Instance method to update last login
 */
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

/**
 * Instance method to add device info
 * @param {Object} deviceInfo - Device information
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

/**
 * Pre-save middleware to hash sensitive data if needed
 */
userSchema.pre('save', async function(next) {
  // If OTP is being set, ensure it's properly formatted
  if (this.isModified('otp') && this.otp && this.otp.code) {
    // OTP is stored in plain text for verification
    // In production, you might want to hash it
  }

  next();
});

/**
 * Pre-find middleware to exclude inactive users by default
 */
userSchema.pre(/^find/, function(next) {
  // Uncomment to exclude inactive users from queries
  // this.find({ isActive: { $ne: false } });
  next();
});

/**
 * Static method to find user by phone number
 * @param {string} phoneNumber - Phone number to search
 * @returns {Promise<User>} User document
 */
userSchema.statics.findByPhoneNumber = function(phoneNumber) {
  return this.findOne({ phoneNumber });
};

/**
 * Static method to find verified users
 * @returns {Promise<User[]>} Array of verified users
 */
userSchema.statics.findVerified = function() {
  return this.find({ isVerified: true, isActive: true });
};

/**
 * Static method to count active users
 * @returns {Promise<number>} Count of active users
 */
userSchema.statics.countActive = function() {
  return this.countDocuments({ isActive: true });
};

// Create and export model
const User = mongoose.model('User', userSchema);

export default User;