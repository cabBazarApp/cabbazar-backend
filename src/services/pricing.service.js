// src/services/pricing.service.js - Complete Pricing Calculation Service
import { 
  PRICING, 
  LOCAL_PACKAGES, 
  AIRPORT_BASE_PRICE, 
  BOOKING_TYPES,
  VEHICLE_TYPES,
  TAX_CONFIG,
  VEHICLE_CAPACITY,
  VEHICLE_FEATURES,
  DISTANCE_CONFIG,
  BOOKING_CONFIG
} from '../config/constants.js';
import { BadRequestError } from '../utils/customError.js';
import { calculateGST, isNightTime } from '../utils/helpers.js';
import logger from '../config/logger.js';

class PricingService {
  /**
   * Calculate fare for outstation trips (one-way or round trip)
   * @param {string} vehicleType - Type of vehicle
   * @param {number} distance - Distance in kilometers
   * @param {boolean} isRoundTrip - Whether it's a round trip
   * @param {Date} startDateTime - Trip start date/time
   * @returns {Object} Fare details
   */
  calculateOutstationFare(vehicleType, distance, isRoundTrip = false, startDateTime = new Date()) {
    // Validate inputs
    if (!PRICING[vehicleType]) {
      throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
    }

    if (distance < DISTANCE_CONFIG.MIN_DISTANCE) {
      throw new BadRequestError(`Minimum distance for outstation is ${DISTANCE_CONFIG.MIN_DISTANCE} km`);
    }

    if (distance > DISTANCE_CONFIG.MAX_DISTANCE) {
      throw new BadRequestError(`Maximum distance per booking is ${DISTANCE_CONFIG.MAX_DISTANCE} km`);
    }

    const rates = PRICING[vehicleType];
    const multiplier = isRoundTrip ? 2 : 1;
    const totalDistance = distance * multiplier;
    
    // Calculate base fare
    let baseFare = totalDistance * rates.perKmRate;
    
    // Apply minimum fare
    if (baseFare < rates.minFare) {
      baseFare = rates.minFare;
    }

    // Apply night charges if applicable (10 PM - 6 AM)
    let nightCharges = 0;
    if (isNightTime(startDateTime)) {
      nightCharges = baseFare * (rates.nightChargeMultiplier - 1);
      logger.info('Night charges applied', { 
        vehicleType, 
        nightCharges: Math.round(nightCharges),
        time: startDateTime 
      });
    }

    // Calculate total before GST
    const totalFare = baseFare + nightCharges;
    
    // Calculate GST
    const gst = calculateGST(totalFare, TAX_CONFIG.GST_RATE);
    
    // Calculate final amount
    const finalAmount = totalFare + gst;

    // Estimated travel time (assuming 60 km/hr average speed)
    const estimatedTravelTime = (totalDistance / 60).toFixed(1);

    logger.info('Outstation fare calculated', {
      vehicleType,
      distance: totalDistance,
      isRoundTrip,
      baseFare: Math.round(baseFare),
      nightCharges: Math.round(nightCharges),
      gst: Math.round(gst),
      finalAmount: Math.round(finalAmount)
    });

    return {
      baseFare: Math.round(baseFare),
      distance: totalDistance,
      nightCharges: Math.round(nightCharges),
      gst: Math.round(gst),
      totalFare: Math.round(totalFare),
      finalAmount: Math.round(finalAmount),
      perKmRate: rates.perKmRate,
      estimatedTravelTime: `${estimatedTravelTime} hours`,
      inclusions: [
        'Driver allowance',
        'Fuel charges',
        'Base fare',
        'GST included'
      ],
      exclusions: [
        'Toll charges',
        'Parking charges',
        'State permit charges (if any)'
      ],
      breakdown: {
        baseCalculation: `${totalDistance} km × ₹${rates.perKmRate}/km = ₹${Math.round(baseFare)}`,
        nightCharges: nightCharges > 0 ? `Night charges (20%) = ₹${Math.round(nightCharges)}` : null,
        gst: `GST (5%) = ₹${Math.round(gst)}`,
        total: `Total = ₹${Math.round(finalAmount)}`
      }
    };
  }

  /**
   * Calculate fare for local rental packages
   * @param {string} vehicleType - Type of vehicle
   * @param {string} packageType - Package type (8_80 or 12_120)
   * @param {Object} extras - Extra km/hours if exceeded
   * @returns {Object} Fare details
   */
  calculateLocalPackageFare(vehicleType, packageType, extras = {}) {
    // Validate package type
    const pkg = LOCAL_PACKAGES[packageType];
    if (!pkg) {
      throw new BadRequestError(`Invalid package type: ${packageType}. Available: 8_80, 12_120`);
    }

    // Get base fare for vehicle type
    const vehicleKey = vehicleType.toLowerCase();
    const baseFare = pkg[vehicleKey];
    
    if (!baseFare) {
      throw new BadRequestError(`Vehicle type ${vehicleType} not available for package ${packageType}`);
    }

    // Calculate extra charges if package exceeded
    let extraKmCharge = 0;
    let extraHourCharge = 0;

    if (extras.extraKm && extras.extraKm > 0) {
      extraKmCharge = extras.extraKm * pkg.extraKmCharge[vehicleKey];
    }

    if (extras.extraHours && extras.extraHours > 0) {
      extraHourCharge = extras.extraHours * pkg.extraHourCharge[vehicleKey];
    }

    // Calculate total fare
    const totalFare = baseFare + extraKmCharge + extraHourCharge;

    // Calculate GST
    const gst = calculateGST(totalFare, TAX_CONFIG.GST_RATE);
    const finalAmount = totalFare + gst;

    logger.info('Local package fare calculated', {
      vehicleType,
      packageType,
      baseFare,
      extraKmCharge,
      extraHourCharge,
      finalAmount: Math.round(finalAmount)
    });

    return {
      baseFare,
      distance: pkg.km,
      duration: pkg.hours,
      extraKmCharge: Math.round(extraKmCharge),
      extraHourCharge: Math.round(extraHourCharge),
      gst: Math.round(gst),
      totalFare: Math.round(totalFare),
      finalAmount: Math.round(finalAmount),
      extraKmRate: pkg.extraKmCharge[vehicleKey],
      extraHourRate: pkg.extraHourCharge[vehicleKey],
      inclusions: [
        `${pkg.hours} hours included`,
        `${pkg.km} kilometers included`,
        'Fuel charges included',
        'Driver allowance included',
        'GST included'
      ],
      exclusions: [
        'Toll charges',
        'Parking charges',
        `Extra km: ₹${pkg.extraKmCharge[vehicleKey]}/km`,
        `Extra hour: ₹${pkg.extraHourCharge[vehicleKey]}/hr`
      ],
      breakdown: {
        packageCharge: `${pkg.hours}hrs/${pkg.km}km Package = ₹${baseFare}`,
        extraKm: extraKmCharge > 0 ? `Extra ${extras.extraKm} km × ₹${pkg.extraKmCharge[vehicleKey]} = ₹${Math.round(extraKmCharge)}` : null,
        extraHour: extraHourCharge > 0 ? `Extra ${extras.extraHours} hrs × ₹${pkg.extraHourCharge[vehicleKey]} = ₹${Math.round(extraHourCharge)}` : null,
        gst: `GST (5%) = ₹${Math.round(gst)}`,
        total: `Total = ₹${Math.round(finalAmount)}`
      }
    };
  }

  /**
   * Calculate fare for airport transfers
   * @param {string} vehicleType - Type of vehicle
   * @param {number} distance - Distance in kilometers
   * @param {Date} startDateTime - Trip start date/time
   * @returns {Object} Fare details
   */
  calculateAirportFare(vehicleType, distance, startDateTime = new Date()) {
    // Validate vehicle type
    const basePrice = AIRPORT_BASE_PRICE[vehicleType];
    if (!basePrice) {
      throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`);
    }

    // Validate distance
    if (distance <= 0) {
      throw new BadRequestError('Distance must be greater than 0');
    }

    // Calculate extra km charges (after first 10 km)
    const freeKm = DISTANCE_CONFIG.FREE_KM_FOR_AIRPORT || 10;
    const extraKm = Math.max(0, distance - freeKm);
    const extraKmCharge = extraKm * PRICING[vehicleType].perKmRate;
    
    // Base fare = base price + extra km charges
    let baseFare = basePrice + extraKmCharge;

    // Apply night charges if applicable (10 PM - 6 AM)
    let nightCharges = 0;
    if (isNightTime(startDateTime)) {
      nightCharges = baseFare * (PRICING[vehicleType].nightChargeMultiplier - 1);
      logger.info('Airport night charges applied', { 
        vehicleType, 
        nightCharges: Math.round(nightCharges) 
      });
    }

    // Calculate total fare
    const totalFare = baseFare + nightCharges;
    
    // Calculate GST
    const gst = calculateGST(totalFare, TAX_CONFIG.GST_RATE);
    
    // Calculate final amount
    const finalAmount = totalFare + gst;

    // Estimated travel time (assuming 40 km/hr in city traffic)
    const estimatedTravelTime = (distance / 40).toFixed(1);

    logger.info('Airport fare calculated', {
      vehicleType,
      distance,
      baseFare: Math.round(baseFare),
      nightCharges: Math.round(nightCharges),
      finalAmount: Math.round(finalAmount)
    });

    return {
      baseFare: Math.round(baseFare),
      distance,
      freeKmIncluded: freeKm,
      extraKm: Math.round(extraKm * 10) / 10,
      nightCharges: Math.round(nightCharges),
      gst: Math.round(gst),
      totalFare: Math.round(totalFare),
      finalAmount: Math.round(finalAmount),
      estimatedTravelTime: `${estimatedTravelTime} hours`,
      inclusions: [
        'Airport pickup/drop',
        `First ${freeKm} km included`,
        'Driver allowance',
        'Fuel charges',
        'GST included'
      ],
      exclusions: [
        'Toll charges',
        'Parking charges',
        `Extra km: ₹${PRICING[vehicleType].perKmRate}/km`
      ],
      breakdown: {
        basePrice: `Base charge = ₹${basePrice}`,
        extraKm: extraKm > 0 ? `Extra ${Math.round(extraKm * 10) / 10} km × ₹${PRICING[vehicleType].perKmRate} = ₹${Math.round(extraKmCharge)}` : `First ${freeKm} km included`,
        nightCharges: nightCharges > 0 ? `Night charges (20%) = ₹${Math.round(nightCharges)}` : null,
        gst: `GST (5%) = ₹${Math.round(gst)}`,
        total: `Total = ₹${Math.round(finalAmount)}`
      }
    };
  }

  /**
   * Get all vehicle options with pricing for a booking
   * @param {string} bookingType - Type of booking
   * @param {Object} params - Booking parameters
   * @returns {Array} Array of vehicle options with pricing
   */
  getVehicleOptions(bookingType, params) {
    const options = [];

    // Validate booking type
    if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
      throw new BadRequestError(`Invalid booking type: ${bookingType}`);
    }

    // Validate required parameters
    if (!params.distance && bookingType !== BOOKING_TYPES.LOCAL_8_80 && bookingType !== BOOKING_TYPES.LOCAL_12_120) {
      throw new BadRequestError('Distance is required for this booking type');
    }

    // Iterate through all vehicle types
    Object.values(VEHICLE_TYPES).forEach(vehicleType => {
      try {
        let fareDetails;
        const startDateTime = params.startDateTime ? new Date(params.startDateTime) : new Date();

        // Calculate fare based on booking type
        switch (bookingType) {
          case BOOKING_TYPES.ONE_WAY:
            fareDetails = this.calculateOutstationFare(
              vehicleType, 
              params.distance, 
              false, 
              startDateTime
            );
            break;

          case BOOKING_TYPES.ROUND_TRIP:
            fareDetails = this.calculateOutstationFare(
              vehicleType, 
              params.distance, 
              true, 
              startDateTime
            );
            break;

          case BOOKING_TYPES.LOCAL_8_80:
            fareDetails = this.calculateLocalPackageFare(vehicleType, '8_80', params.extras);
            break;

          case BOOKING_TYPES.LOCAL_12_120:
            fareDetails = this.calculateLocalPackageFare(vehicleType, '12_120', params.extras);
            break;

          case BOOKING_TYPES.AIRPORT_DROP:
          case BOOKING_TYPES.AIRPORT_PICKUP:
            fareDetails = this.calculateAirportFare(
              vehicleType, 
              params.distance, 
              startDateTime
            );
            break;

          default:
            logger.warn(`Unsupported booking type: ${bookingType}`);
            return;
        }

        // Add vehicle option with all details
        options.push({
          vehicleType,
          displayName: this.getVehicleDisplayName(vehicleType),
          modelExamples: this.getVehicleModelExamples(vehicleType),
          capacity: this.getVehicleCapacity(vehicleType),
          features: this.getVehicleFeatures(vehicleType),
          fareDetails,
          recommended: vehicleType === 'SEDAN', // Mark sedan as recommended
          available: true,
          description: this.getVehicleDescription(vehicleType)
        });

      } catch (error) {
        // Skip vehicles not available for this booking type
        logger.debug(`Skipping ${vehicleType} for ${bookingType}: ${error.message}`);
      }
    });

    // Sort by price (ascending)
    options.sort((a, b) => a.fareDetails.finalAmount - b.fareDetails.finalAmount);

    logger.info('Vehicle options generated', {
      bookingType,
      optionsCount: options.length,
      params: {
        distance: params.distance,
        hasStartDateTime: !!params.startDateTime
      }
    });

    return options;
  }

  /**
   * Calculate discount amount
   * @param {number} baseAmount - Base amount
   * @param {string} discountCode - Discount code
   * @param {string} userId - User ID (for user-specific discounts)
   * @returns {Object} Discount details
   */
  calculateDiscount(baseAmount, discountCode, userId = null) {
    // Discount database (in production, fetch from database)
    const discounts = {
      'FIRST10': { 
        type: 'PERCENTAGE', 
        value: 10, 
        maxDiscount: 200,
        minAmount: 500,
        description: 'First booking discount - 10% off'
      },
      'FLAT50': { 
        type: 'FLAT', 
        value: 50,
        minAmount: 500,
        description: 'Flat ₹50 off'
      },
      'SUMMER20': { 
        type: 'PERCENTAGE', 
        value: 20, 
        maxDiscount: 500,
        minAmount: 1000,
        description: 'Summer special - 20% off'
      },
      'FLAT100': { 
        type: 'FLAT', 
        value: 100,
        minAmount: 1000,
        description: 'Flat ₹100 off on bookings above ₹1000'
      },
      'WEEKEND15': { 
        type: 'PERCENTAGE', 
        value: 15, 
        maxDiscount: 300,
        minAmount: 800,
        description: 'Weekend special - 15% off'
      }
    };

    const discount = discounts[discountCode.toUpperCase()];
    
    if (!discount) {
      logger.warn('Invalid discount code attempted', { discountCode, userId });
      return { 
        discountAmount: 0, 
        discountCode: null, 
        message: 'Invalid discount code',
        applied: false
      };
    }

    // Check minimum amount requirement
    if (baseAmount < discount.minAmount) {
      return {
        discountAmount: 0,
        discountCode: null,
        message: `Minimum booking amount of ₹${discount.minAmount} required for this discount`,
        applied: false
      };
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (discount.type === 'PERCENTAGE') {
      discountAmount = (baseAmount * discount.value) / 100;
      if (discount.maxDiscount) {
        discountAmount = Math.min(discountAmount, discount.maxDiscount);
      }
    } else if (discount.type === 'FLAT') {
      discountAmount = discount.value;
    }

    logger.info('Discount applied', { 
      discountCode, 
      discountAmount: Math.round(discountAmount),
      baseAmount,
      userId 
    });

    return {
      discountAmount: Math.round(discountAmount),
      discountCode: discountCode.toUpperCase(),
      message: discount.description,
      applied: true,
      savings: Math.round(discountAmount)
    };
  }

  /**
   * Calculate cancellation charges
   * @param {number} totalFare - Total booking fare
   * @param {Date} bookingDate - Booking date
   * @param {Date} tripDate - Trip start date
   * @returns {Object} Cancellation charge details
   */
  calculateCancellationCharge(totalFare, bookingDate, tripDate) {
    const now = new Date();
    const hoursUntilTrip = (new Date(tripDate) - now) / (1000 * 60 * 60);

    // Free cancellation if more than 24 hours before trip
    if (hoursUntilTrip >= BOOKING_CONFIG.CANCELLATION_WINDOW_HOURS) {
      return {
        cancellationCharge: 0,
        refundAmount: totalFare,
        reason: `Free cancellation (${Math.floor(hoursUntilTrip)} hours before trip)`,
        refundPercentage: 100
      };
    }

    // Calculate charge based on time remaining
    let chargePercentage = BOOKING_CONFIG.CANCELLATION_CHARGE_PERCENT;
    
    if (hoursUntilTrip < 2) {
      chargePercentage = 50; // 50% charge if cancelled within 2 hours
    } else if (hoursUntilTrip < 6) {
      chargePercentage = 30; // 30% charge if cancelled within 6 hours
    }

    const cancellationCharge = (totalFare * chargePercentage) / 100;
    const refundAmount = totalFare - cancellationCharge;

    logger.info('Cancellation charge calculated', {
      totalFare,
      hoursUntilTrip: Math.floor(hoursUntilTrip),
      chargePercentage,
      cancellationCharge: Math.round(cancellationCharge)
    });

    return {
      cancellationCharge: Math.round(cancellationCharge),
      refundAmount: Math.round(refundAmount),
      reason: `${chargePercentage}% charge (${Math.floor(hoursUntilTrip)} hours before trip)`,
      refundPercentage: 100 - chargePercentage
    };
  }

  /**
   * Calculate total fare with all additions
   * @param {Object} fareDetails - Base fare details
   * @param {Object} additions - Additional charges
   * @returns {Object} Complete fare breakdown
   */
  calculateTotalFare(fareDetails, additions = {}) {
    const { 
      tolls = 0, 
      parking = 0, 
      discount = 0, 
      statePermit = 0,
      extraCharges = 0 
    } = additions;
    
    const subtotal = fareDetails.totalFare || fareDetails.baseFare;
    const totalAdditions = tolls + parking + statePermit + extraCharges;
    const totalBeforeGST = subtotal + totalAdditions - discount;
    const gst = calculateGST(totalBeforeGST, TAX_CONFIG.GST_RATE);
    const finalAmount = totalBeforeGST + gst;

    return {
      baseFare: fareDetails.baseFare,
      nightCharges: fareDetails.nightCharges || 0,
      tolls: Math.round(tolls),
      parking: Math.round(parking),
      statePermit: Math.round(statePermit),
      extraCharges: Math.round(extraCharges),
      discount: Math.round(discount),
      subtotal: Math.round(subtotal),
      totalAdditions: Math.round(totalAdditions),
      gst: Math.round(gst),
      finalAmount: Math.round(finalAmount),
      breakdown: {
        baseFare: `Base fare = ₹${Math.round(fareDetails.baseFare)}`,
        nightCharges: fareDetails.nightCharges > 0 ? `Night charges = ₹${Math.round(fareDetails.nightCharges)}` : null,
        tolls: tolls > 0 ? `Toll charges = ₹${Math.round(tolls)}` : null,
        parking: parking > 0 ? `Parking charges = ₹${Math.round(parking)}` : null,
        statePermit: statePermit > 0 ? `State permit = ₹${Math.round(statePermit)}` : null,
        extraCharges: extraCharges > 0 ? `Extra charges = ₹${Math.round(extraCharges)}` : null,
        discount: discount > 0 ? `Discount = -₹${Math.round(discount)}` : null,
        gst: `GST (5%) = ₹${Math.round(gst)}`,
        total: `Total = ₹${Math.round(finalAmount)}`
      }
    };
  }

  /**
   * Get vehicle capacity details
   * @param {string} vehicleType - Vehicle type
   * @returns {Object} Capacity details
   */
  getVehicleCapacity(vehicleType) {
    return VEHICLE_CAPACITY[vehicleType] || { passengers: 4, luggage: 2 };
  }

  /**
   * Get vehicle features
   * @param {string} vehicleType - Vehicle type
   * @returns {Array} Array of features
   */
  getVehicleFeatures(vehicleType) {
    return VEHICLE_FEATURES[vehicleType] || ['AC', 'Music System'];
  }

  /**
   * Get example vehicle models
   * @param {string} vehicleType - Vehicle type
   * @returns {Array} Array of model names
   */
  getVehicleModelExamples(vehicleType) {
    const models = {
      HATCHBACK: ['Maruti Swift', 'Hyundai i20', 'Maruti Baleno'],
      SEDAN: ['Honda City', 'Hyundai Verna', 'Maruti Ciaz', 'Honda Amaze'],
      SUV: ['Toyota Innova Crysta', 'Maruti Ertiga', 'Mahindra XUV500', 'Kia Carens'],
      PREMIUM_SEDAN: ['Honda Accord', 'Toyota Camry', 'Skoda Superb', 'BMW 3 Series']
    };
    return models[vehicleType] || [];
  }

  /**
   * Get vehicle display name
   * @param {string} vehicleType - Vehicle type
   * @returns {string} Display name
   */
  getVehicleDisplayName(vehicleType) {
    const displayNames = {
      HATCHBACK: 'AC Hatchback',
      SEDAN: 'AC Sedan',
      SUV: 'AC SUV / MUV',
      PREMIUM_SEDAN: 'Premium Sedan'
    };
    return displayNames[vehicleType] || vehicleType;
  }

  /**
   * Get vehicle description
   * @param {string} vehicleType - Vehicle type
   * @returns {string} Description
   */
  getVehicleDescription(vehicleType) {
    const descriptions = {
      HATCHBACK: 'Comfortable and economical for short trips',
      SEDAN: 'Perfect for city and outstation trips',
      SUV: 'Spacious for families and groups',
      PREMIUM_SEDAN: 'Luxury travel experience'
    };
    return descriptions[vehicleType] || '';
  }

  /**
   * Estimate distance using coordinates (Haversine formula)
   * In production, integrate with Google Maps Distance Matrix API
   * @param {Object} origin - Origin coordinates {lat, lng}
   * @param {Object} destination - Destination coordinates {lat, lng}
   * @returns {number} Distance in kilometers
   */
  calculateDistanceFromCoordinates(origin, destination) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(destination.lat - origin.lat);
    const dLon = this.toRad(destination.lng - origin.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(origin.lat)) * Math.cos(this.toRad(destination.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    // Add 20% for actual road distance (approximation)
    const roadDistance = distance * 1.2;
    
    return Math.round(roadDistance * 10) / 10;
  }

  /**
   * Convert degrees to radians
   * @param {number} degrees - Degrees
   * @returns {number} Radians
   */
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Validate fare calculation parameters
   * @param {string} bookingType - Booking type
   * @param {Object} params - Parameters
   * @returns {Object} Validation result
   */
  validateFareParams(bookingType, params) {
    const errors = [];

    // Validate booking type
    if (!Object.values(BOOKING_TYPES).includes(bookingType)) {
      errors.push('Invalid booking type');
    }

    // Validate distance for applicable booking types
    const requiresDistance = [
      BOOKING_TYPES.ONE_WAY,
      BOOKING_TYPES.ROUND_TRIP,
      BOOKING_TYPES.AIRPORT_DROP,
      BOOKING_TYPES.AIRPORT_PICKUP
    ];

    if (requiresDistance.includes(bookingType)) {
      if (!params.distance || params.distance <= 0) {
        errors.push('Distance is required and must be greater than 0');
      }
      if (params.distance > DISTANCE_CONFIG.MAX_DISTANCE) {
        errors.push(`Distance cannot exceed ${DISTANCE_CONFIG.MAX_DISTANCE} km`);
      }
    }

    // Validate date
    if (params.startDateTime) {
      const date = new Date(params.startDateTime);
      if (isNaN(date.getTime())) {
        errors.push('Invalid start date/time');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Export singleton instance
export default new PricingService();