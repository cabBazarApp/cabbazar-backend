// src/controllers/booking.controller.js - Simplified Booking Controller
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import pricingService from '../services/pricing.service.js';
import { sendSuccess, sendPaginatedResponse } from '../utils/response.js';
import { catchAsync } from '../utils/catchAsync.js';
import {
  NotFoundError,
  BadRequestError,
  ConflictError
} from '../utils/customError.js';
import {
  BOOKING_STATUS,
  BOOKING_TYPES,
  BOOKING_CONFIG
} from '../config/constants.js';
import {
  parsePagination,
  addDays,
  addHours,
  generateBookingReference
} from '../utils/helpers.js';
import logger from '../config/logger.js';
import {
  sendBookingNotification,
  sendDriverNotification,
  sendTripNotification
} from '../utils/notification.utils.js';

/**
 * @desc    Search for available cabs and get pricing
 * @route   POST /api/bookings/search
 * @access  Public
 */
export const searchCabs = catchAsync(async (req, res) => {
  const {
    from,
    to,
    date,
    type,
    distance,
    startDateTime,
    fromCoordinates,
    toCoordinates
  } = req.body;

  // ========================================
  // VALIDATION
  // ========================================

  if (!from || !to) {
    throw new BadRequestError('Pickup and drop locations are required');
  }

  if (!type) {
    throw new BadRequestError('Booking type is required');
  }

  if (!Object.values(BOOKING_TYPES).includes(type)) {
    throw new BadRequestError(`Invalid booking type: ${type}`);
  }

  // Validate date (must be at least 2 hours in future)
  const tripDate = new Date(date || startDateTime);

  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid date format');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);

  if (tripDate < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`
    );
  }

  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);

  if (tripDate > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
    );
  }

  // ========================================
  // DISTANCE CALCULATION
  // ========================================

  let estimatedDistance = distance;

  // Calculate distance from coordinates if provided
  if (!estimatedDistance && fromCoordinates && toCoordinates) {
    try {
      estimatedDistance = pricingService.calculateDistanceFromCoordinates(
        fromCoordinates,
        toCoordinates
      );
      logger.info('Distance calculated from coordinates', { estimatedDistance });
    } catch (error) {
      logger.warn('Failed to calculate distance from coordinates', {
        error: error.message
      });
      estimatedDistance = 100; // Default fallback
    }
  }

  if (!estimatedDistance) {
    estimatedDistance = 100; // Default fallback
  }

  logger.info('Cab search initiated', {
    from,
    to,
    type,
    distance: estimatedDistance,
    userId: req.user?._id || 'guest',
    tripDate: tripDate.toISOString()
  });

  // ========================================
  // GET VEHICLE OPTIONS WITH PRICING
  // ========================================

  const vehicleOptions = pricingService.getVehicleOptions(type, {
    distance: estimatedDistance,
    startDateTime: tripDate
  });

  // ========================================
  // RESPONSE
  // ========================================

  const searchResults = {
    searchId: generateBookingReference(),
    from,
    to,
    date: tripDate,
    type,
    distance: estimatedDistance,
    options: vehicleOptions,
    validUntil: addHours(new Date(), 1), // Valid for 1 hour
    timestamp: new Date(),
    hasCoordinates: !!(fromCoordinates && toCoordinates)
  };

  logger.info('Search results generated', {
    searchId: searchResults.searchId,
    optionsCount: vehicleOptions.length
  });

  return sendSuccess(res, searchResults, 'Search results retrieved successfully', 200);
});

/**
 * @desc    Create a new booking
 * @route   POST /api/bookings
 * @access  Private
 */
export const createBooking = catchAsync(async (req, res) => {
  const {
    bookingType,
    pickupLocation,
    dropLocation,
    startDateTime,
    endDateTime,
    vehicleType,
    passengerDetails,
    fareDetails,
    specialRequests,
    notes,
    searchId
  } = req.body;

  // ========================================
  // VALIDATION
  // ========================================

  // Validate required fields
  if (!bookingType || !pickupLocation || !startDateTime || !vehicleType || !fareDetails) {
    throw new BadRequestError('Missing required booking information');
  }

  // Validate booking date
  const tripDate = new Date(startDateTime);

  if (isNaN(tripDate.getTime())) {
    throw new BadRequestError('Invalid start date/time');
  }

  const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);
  const maxBookingTime = addDays(new Date(), BOOKING_CONFIG.ADVANCE_BOOKING_DAYS);

  if (tripDate < minBookingTime) {
    throw new BadRequestError(
      `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`
    );
  }

  if (tripDate > maxBookingTime) {
    throw new BadRequestError(
      `Cannot book more than ${BOOKING_CONFIG.ADVANCE_BOOKING_DAYS} days in advance`
    );
  }

  // Check for duplicate bookings (same user, same time, not cancelled)
  const existingBooking = await Booking.findOne({
    userId: req.user._id,
    startDateTime: {
      $gte: new Date(tripDate.getTime() - 30 * 60 * 1000), // 30 min before
      $lte: new Date(tripDate.getTime() + 30 * 60 * 1000) // 30 min after
    },
    status: { $nin: [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.COMPLETED] }
  });

  if (existingBooking) {
    throw new ConflictError(
      `You already have a booking at ${existingBooking.startDateTime.toLocaleString()}. Please cancel it first or choose a different time.`
    );
  }

  // Validate fare amount
  if (!fareDetails.finalAmount || fareDetails.finalAmount < 0) {
    throw new BadRequestError('Invalid fare details');
  }

  logger.info('Creating new booking', {
    userId: req.user._id,
    bookingType,
    vehicleType,
    startDateTime: tripDate.toISOString()
  });

  // ========================================
  // CREATE BOOKING
  // ========================================

  const booking = await Booking.create({
    userId: req.user._id,
    bookingId: generateBookingReference(),
    bookingType,
    pickupLocation,
    dropLocation,
    startDateTime: tripDate,
    endDateTime: endDateTime ? new Date(endDateTime) : null,
    vehicleType,
    passengerDetails: passengerDetails || {
      name: req.user.name,
      phone: req.user.phoneNumber,
      email: req.user.email
    },
    fareDetails,
    status: BOOKING_STATUS.CONFIRMED,
    specialRequests: specialRequests || [],
    notes,
    metadata: {
      source: 'MOBILE_APP',
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      searchId
    }
  });

  // Populate user details
  await booking.populate('userId', 'phoneNumber name email');

  logger.info('Booking created successfully', {
    bookingId: booking.bookingId,
    userId: req.user._id,
    status: booking.status,
    fareAmount: booking.fareDetails.finalAmount
  });

  // ========================================
  // SEND NOTIFICATIONS
  // ========================================

  // Send booking confirmation notification to user
  if (req.user.deviceInfo && req.user.deviceInfo.length > 0) {
    const fcmToken = req.user.deviceInfo[0].fcmToken;

    if (fcmToken) {
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'confirmed',
        `Your booking ${booking.bookingId} is confirmed for ${tripDate.toLocaleDateString()}`
      ).catch(error => {
        logger.error('Failed to send booking confirmation notification', {
          error: error.message
        });
      });
    }
  }

  // TODO: Send SMS confirmation
  // TODO: Send email confirmation
  // TODO: Notify nearby drivers

  return sendSuccess(
    res,
    {
      booking,
      message: 'Your booking has been confirmed. You will receive driver details shortly.'
    },
    'Booking created successfully',
    201
  );
});

/**
 * @desc    Get booking by ID
 * @route   GET /api/bookings/:id
 * @access  Private
 */
export const getBooking = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email')
    .populate('vehicleId')
    .populate('driverId', 'name phoneNumber rating totalRides');

  if (!booking) {
    logger.warn('Booking not found', {
      bookingId: req.params.id,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(res, booking, 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get booking by booking code
 * @route   GET /api/bookings/code/:bookingId
 * @access  Private
 */
export const getBookingByCode = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    bookingId: req.params.bookingId,
    userId: req.user._id
  })
    .populate('userId', 'phoneNumber name email')
    .populate('vehicleId')
    .populate('driverId', 'name phoneNumber rating totalRides');

  if (!booking) {
    logger.warn('Booking not found by code', {
      bookingId: req.params.bookingId,
      userId: req.user._id
    });
    throw new NotFoundError('Booking not found');
  }

  logger.info('Booking retrieved by code', {
    bookingId: booking.bookingId
  });

  return sendSuccess(res, booking, 'Booking retrieved successfully', 200);
});

/**
 * @desc    Get all bookings for current user
 * @route   GET /api/bookings
 * @access  Private
 */
export const getAllBookings = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, bookingType, fromDate, toDate } = req.query;

  // Build query
  const query = { userId: req.user._id };

  if (status) {
    const statuses = status.split(',').map(s => s.toUpperCase());
    query.status = { $in: statuses };
  }

  if (bookingType) {
    query.bookingType = bookingType.toUpperCase();
  }

  if (fromDate || toDate) {
    query.startDateTime = {};
    if (fromDate) {
      const from = new Date(fromDate);
      if (!isNaN(from.getTime())) {
        query.startDateTime.$gte = from;
      }
    }
    if (toDate) {
      const to = new Date(toDate);
      if (!isNaN(to.getTime())) {
        query.startDateTime.$lte = to;
      }
    }
  }

  // Get bookings with pagination
  const bookings = await Booking.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating');

  // Get total count
  const total = await Booking.countDocuments(query);

  logger.info('User bookings retrieved', {
    userId: req.user._id,
    count: bookings.length,
    total,
    filters: { status, bookingType, fromDate, toDate }
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Bookings retrieved successfully'
  );
});

/**
 * @desc    Cancel booking
 * @route   PATCH /api/bookings/:id/cancel
 * @access  Private
 */
export const cancelBooking = catchAsync(async (req, res) => {
  const { reason } = req.body;

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).populate('driverId');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Check if booking can be cancelled
  if (![BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED].includes(booking.status)) {
    throw new BadRequestError(
      `Cannot cancel booking with status: ${booking.status}`
    );
  }

  // Calculate cancellation charge
  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);

  let cancellationCharge = 0;

  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS) {
    cancellationCharge = Math.round(
      (booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) / 100
    );
  }

  // Update booking status
  booking.status = BOOKING_STATUS.CANCELLED;
  booking.cancellation = {
    cancelledBy: 'USER',
    cancelledAt: new Date(),
    reason: reason || 'User requested cancellation',
    charge: cancellationCharge
  };

  await booking.save();

  logger.info('Booking cancelled', {
    bookingId: booking.bookingId,
    userId: req.user._id,
    cancellationCharge,
    reason
  });

  // ========================================
  // SEND NOTIFICATIONS
  // ========================================

  // Notify user
  if (req.user.deviceInfo && req.user.deviceInfo.length > 0) {
    const fcmToken = req.user.deviceInfo[0].fcmToken;

    if (fcmToken) {
      sendBookingNotification(
        fcmToken,
        booking.bookingId,
        'cancelled',
        `Your booking ${booking.bookingId} has been cancelled. ${cancellationCharge > 0
          ? `Cancellation charge: ₹${cancellationCharge}`
          : 'No cancellation charge applied.'
        }`
      ).catch(error => {
        logger.error('Failed to send cancellation notification', {
          error: error.message
        });
      });
    }
  }

  // Notify driver if assigned
  if (booking.driverId) {
    // TODO: Get driver's FCM token and send notification
    logger.info('Driver should be notified of cancellation', {
      driverId: booking.driverId._id
    });
  }

  // TODO: Process refund if applicable
  // TODO: Send cancellation confirmation SMS/email

  const refundAmount = booking.fareDetails.finalAmount - cancellationCharge;

  return sendSuccess(
    res,
    {
      booking,
      cancellationCharge,
      refundAmount,
      refundNote:
        cancellationCharge > 0
          ? `₹${cancellationCharge} cancellation charge applied. Refund of ₹${refundAmount} will be processed within 5-7 business days.`
          : 'Full refund will be processed within 5-7 business days.'
    },
    'Booking cancelled successfully',
    200
  );
});

/**
 * @desc    Update booking (modify details before confirmation)
 * @route   PUT /api/bookings/:id
 * @access  Private
 */
export const updateBooking = catchAsync(async (req, res) => {
  const {
    pickupLocation,
    dropLocation,
    startDateTime,
    specialRequests,
    notes
  } = req.body;

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Only allow updates for CONFIRMED status
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new BadRequestError(
      'Only confirmed bookings can be updated. Current status: ' + booking.status
    );
  }

  // Update fields if provided
  if (pickupLocation) booking.pickupLocation = pickupLocation;
  if (dropLocation) booking.dropLocation = dropLocation;
  if (startDateTime) {
    const newDate = new Date(startDateTime);

    if (isNaN(newDate.getTime())) {
      throw new BadRequestError('Invalid start date/time');
    }

    const minBookingTime = addHours(new Date(), BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD);

    if (newDate < minBookingTime) {
      throw new BadRequestError(
        `Booking must be at least ${BOOKING_CONFIG.MIN_BOOKING_HOURS_AHEAD} hours in advance`
      );
    }

    booking.startDateTime = newDate;
  }
  if (specialRequests) booking.specialRequests = specialRequests;
  if (notes) booking.notes = notes;

  await booking.save();

  logger.info('Booking updated', {
    bookingId: booking.bookingId,
    userId: req.user._id
  });

  return sendSuccess(res, booking, 'Booking updated successfully', 200);
});

/**
 * @desc    Get upcoming bookings
 * @route   GET /api/bookings/upcoming
 * @access  Private
 */
export const getUpcomingBookings = catchAsync(async (req, res) => {
  const bookings = await Booking.find({
    userId: req.user._id,
    startDateTime: { $gte: new Date() },
    status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED] }
  })
    .sort({ startDateTime: 1 })
    .limit(10)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating');

  logger.info('Upcoming bookings retrieved', {
    userId: req.user._id,
    count: bookings.length
  });

  return sendSuccess(res, bookings, 'Upcoming bookings retrieved successfully', 200);
});

/**
 * @desc    Get booking history
 * @route   GET /api/bookings/history
 * @access  Private
 */
export const getBookingHistory = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const bookings = await Booking.find({
    userId: req.user._id,
    status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED] }
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('vehicleId', 'type modelName licensePlate')
    .populate('driverId', 'name phoneNumber rating');

  const total = await Booking.countDocuments({
    userId: req.user._id,
    status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED] }
  });

  logger.info('Booking history retrieved', {
    userId: req.user._id,
    count: bookings.length,
    total
  });

  return sendPaginatedResponse(
    res,
    bookings,
    page,
    limit,
    total,
    'Booking history retrieved successfully'
  );
});

/**
 * @desc    Add rating to completed booking
 * @route   POST /api/bookings/:id/rating
 * @access  Private
 */
export const addRating = catchAsync(async (req, res) => {
  const { rating, comment } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new BadRequestError('Rating must be between 1 and 5');
  }

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).populate('driverId');

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  if (booking.status !== BOOKING_STATUS.COMPLETED) {
    throw new BadRequestError('Can only rate completed bookings');
  }

  if (booking.rating && booking.rating.value) {
    throw new ConflictError('Booking has already been rated');
  }

  // Add rating to booking
  booking.rating = {
    value: rating,
    comment: comment || '',
    createdAt: new Date()
  };

  await booking.save();

  logger.info('Rating added to booking', {
    bookingId: booking.bookingId,
    rating,
    driverId: booking.driverId?._id
  });

  // TODO: Update driver's overall rating
  // TODO: Send thank you notification to user

  return sendSuccess(res, booking, 'Rating submitted successfully', 200);
});

/**
 * @desc    Get booking statistics
 * @route   GET /api/bookings/stats
 * @access  Private
 */
export const getBookingStats = catchAsync(async (req, res) => {
  const userId = req.user._id;

  const [totalBookings, stats, favoriteVehicle] = await Promise.all([
    Booking.countDocuments({ userId }),
    Booking.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', BOOKING_STATUS.COMPLETED] }, 1, 0]
            }
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ['$status', BOOKING_STATUS.CANCELLED] }, 1, 0]
            }
          },
          totalSpent: {
            $sum: {
              $cond: [
                { $eq: ['$status', BOOKING_STATUS.COMPLETED] },
                '$fareDetails.finalAmount',
                0
              ]
            }
          }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { userId } },
      { $group: { _id: '$vehicleType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ])
  ]);

  const result = {
    totalBookings,
    completedBookings: stats[0]?.completed || 0,
    cancelledBookings: stats[0]?.cancelled || 0,
    upcomingBookings: await Booking.countDocuments({
      userId,
      startDateTime: { $gte: new Date() },
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED] }
    }),
    totalSpent: Math.round(stats[0]?.totalSpent || 0),
    averageSpendPerBooking:
      stats[0]?.completed > 0
        ? Math.round(stats[0]?.totalSpent / stats[0]?.completed)
        : 0,
    favoriteVehicleType: favoriteVehicle[0]?._id || null,
    completionRate:
      totalBookings > 0
        ? Math.round(((stats[0]?.completed || 0) / totalBookings) * 100)
        : 0
  };

  return sendSuccess(res, result, 'Statistics retrieved successfully', 200);
});

/**
 * @desc    Apply discount code to booking
 * @route   POST /api/bookings/:id/apply-discount
 * @access  Private
 * @note    Placeholder function to fix crash
 */
export const applyDiscount = catchAsync(async (req, res) => {
  const { discountCode } = req.body;

  logger.info('Apply discount placeholder hit', {
    bookingId: req.params.id,
    userId: req.user._id,
    discountCode
  });

  // TODO: Implement discount logic
  // 1. Find booking
  // 2. Validate discount code
  // 3. Apply discount to fareDetails
  // 4. Save booking

  throw new BadRequestError('Discount functionality is not yet implemented.');
});

/**
 * @desc    Get fare estimate for a route
 * @route   POST /api/bookings/estimate
 * @access  Public
 */
export const getFareEstimate = catchAsync(async (req, res) => {
  const { from, to, type, distance, vehicleType, startDateTime } = req.body;

  if (!type || !distance || !vehicleType) {
    throw new BadRequestError('Booking type, distance, and vehicle type are required');
  }

  const tripDate = startDateTime ? new Date(startDateTime) : new Date();

  let fareDetails;

  // Calculate fare based on booking type
  if (type === BOOKING_TYPES.ONE_WAY) {
    fareDetails = pricingService.calculateOutstationFare(
      vehicleType,
      distance,
      false,
      tripDate
    );
  } else if (type === BOOKING_TYPES.ROUND_TRIP) {
    fareDetails = pricingService.calculateOutstationFare(
      vehicleType,
      distance,
      true,
      tripDate
    );
  } else if (type === BOOKING_TYPES.LOCAL_8_80) {
    fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '8_80');
  } else if (type === BOOKING_TYPES.LOCAL_12_120) {
    fareDetails = pricingService.calculateLocalPackageFare(vehicleType, '12_120');
  } else if (
    type === BOOKING_TYPES.AIRPORT_PICKUP ||
    type === BOOKING_TYPES.AIRPORT_DROP
  ) {
    fareDetails = pricingService.calculateAirportFare(vehicleType, distance, tripDate);
  } else {
    throw new BadRequestError('Invalid booking type');
  }

  logger.info('Fare estimate calculated', {
    from,
    to,
    type,
    vehicleType,
    distance,
    estimatedFare: fareDetails.finalAmount
  });

  return sendSuccess(
    res,
    {
      from,
      to,
      fareDetails,
      validUntil: addHours(new Date(), 1)
    },
    'Fare estimate calculated successfully',
    200
  );
});

// ADDED: getCancellationCharges function (placeholder)
/**
 * @desc    Get cancellation charges for a booking
 * @route   GET /api/bookings/:id/cancellation-charges
 * @access  Private
 * @note    Placeholder function to fix crash
 */
export const getCancellationCharges = catchAsync(async (req, res) => {
  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // Calculate cancellation charge
  const hoursUntilStart = (new Date(booking.startDateTime) - new Date()) / (1000 * 60 * 60);
  let cancellationCharge = 0;

  if (hoursUntilStart < BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS) {
    cancellationCharge = Math.round(
      (booking.fareDetails.finalAmount * BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT) / 100
    );
  }

  logger.info('Cancellation charges calculated', {
    bookingId: booking.bookingId,
    cancellationCharge
  });

  return sendSuccess(
    res,
    {
      bookingId: booking.bookingId,
      cancellationCharge,
      hoursUntilStart,
      cancellationWindowHours: BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS,
      chargePercent: BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT,
      message: cancellationCharge > 0 
        ? `A charge of ₹${cancellationCharge} will apply.`
        : 'No cancellation charges will apply.'
    },
    'Cancellation charges retrieved successfully',
    200
  );
});

// ADDED: updateBookingStatus function (placeholder)
/**
 * @desc    Update booking status
 * @route   PATCH /api/bookings/:id/status
 * @access  Private
 * @note    Placeholder function to fix crash
 */
export const updateBookingStatus = catchAsync(async (req, res) => {
  const { status } = req.body;

  const booking = await Booking.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!booking) {
    throw new NotFoundError('Booking not found');
  }
  
  // TODO: Add logic to validate status transitions
  // e.g., can only move from ASSIGNED to IN_PROGRESS

  booking.status = status;
  await booking.save();
  
  logger.info('Booking status updated', {
    bookingId: booking.bookingId,
    newStatus: status
  });

  return sendSuccess(res, booking, 'Booking status updated successfully', 200);
});

export default {
  searchCabs,
  createBooking,
  getBooking,
  getBookingByCode,
  getAllBookings,
  cancelBooking,
  updateBooking,
  getUpcomingBookings,
  getBookingHistory,
  addRating,
  getBookingStats,
  applyDiscount, // Included
  getFareEstimate,
  getCancellationCharges, // Included
  updateBookingStatus     // Included
};

