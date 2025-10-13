// src/models/Vehicle.js - Complete Vehicle Model
import mongoose from 'mongoose';
import { VEHICLE_TYPES } from '../config/constants.js';

const vehicleSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(VEHICLE_TYPES),
    required: [true, 'Vehicle type is required']
  },
  modelName: {
    type: String,
    required: [true, 'Model name is required'],
    trim: true
  },
  licensePlate: {
    type: String,
    required: [true, 'License plate is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  capacity: {
    type: Number,
    required: true,
    min: [2, 'Capacity must be at least 2'],
    max: [7, 'Capacity cannot exceed 7']
  },
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },
  features: [String],
  year: {
    type: Number,
    min: [2010, 'Vehicle year must be 2010 or later'],
    max: [new Date().getFullYear() + 1, 'Invalid vehicle year']
  },
  color: String,
  fuelType: {
    type: String,
    enum: ['PETROL', 'DIESEL', 'CNG', 'ELECTRIC', 'HYBRID'],
    default: 'DIESEL'
  },
  insurance: {
    policyNumber: String,
    expiryDate: Date,
    provider: String
  },
  documents: {
    rcCopy: String,
    insuranceCopy: String,
    pollutionCertificate: String,
    fitnessExpiry: Date
  },
  maintenance: {
    lastService: Date,
    nextServiceDue: Date,
    totalKm: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

vehicleSchema.index({ type: 1, isAvailable: 1 });
vehicleSchema.index({ licensePlate: 1 });

vehicleSchema.methods.checkAvailability = function(startDate, endDate) {
  // Logic to check if vehicle is available between dates
  // This would query Booking model to check for conflicts
  return this.isAvailable;
};

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

// ===============================================

// src/models/Driver.js - Complete Driver Model
const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Driver name is required'],
    trim: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^[6-9]\d{9}$/, 'Invalid phone number']
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  licenseNumber: {
    type: String,
    required: [true, 'License number is required'],
    unique: true,
    uppercase: true
  },
  licenseExpiry: {
    type: Date,
    required: [true, 'License expiry date is required']
  },
  rating: {
    type: Number,
    default: 5.0,
    min: 0,
    max: 5
  },
  totalRides: {
    type: Number,
    default: 0
  },
  completedRides: {
    type: Number,
    default: 0
  },
  cancelledRides: {
    type: Number,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true,
    index: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle'
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },
  documents: {
    license: String,
    aadhar: String,
    photo: String,
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      accountHolderName: String
    }
  },
  emergencyContact: {
    name: String,
    phone: String,
    relation: String
  },
  earnings: {
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  currentLocation: {
    coordinates: {
      lat: Number,
      lng: Number
    },
    updatedAt: Date
  }
}, {
  timestamps: true
});

driverSchema.index({ isAvailable: 1 });
driverSchema.index({ licenseNumber: 1 });
driverSchema.index({ phoneNumber: 1 });
driverSchema.index({ rating: -1 });

driverSchema.methods.updateRating = async function(newRating) {
  const totalRatings = this.completedRides;
  this.rating = ((this.rating * totalRatings) + newRating) / (totalRatings + 1);
  return this.save();
};

driverSchema.methods.updateLocation = async function(lat, lng) {
  this.currentLocation = {
    coordinates: { lat, lng },
    updatedAt: new Date()
  };
  return this.save({ validateBeforeSave: false });
};

const Driver = mongoose.model('Driver', driverSchema);

export { Vehicle, Driver };
export default { Vehicle, Driver };