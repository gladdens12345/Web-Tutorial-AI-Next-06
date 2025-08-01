/**
 * Session Start Endpoint - Authenticated session creation only
 * 
 * This endpoint handles session creation for authenticated users only.
 * Users must be authenticated to start a session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { generateSessionJWT } from '@/lib/middleware/auth';
import { UserService } from '@/lib/services/user-service';

// Force dynamic rendering to prevent static caching
export const dynamic = 'force-dynamic';

// JWT expiration configuration (environment-based)  
const JWT_EXPIRATION = {
  development: 7200000, // 2 hours for development
  production: 7200000   // 2 hours for production
};

// Get JWT expiration based on environment
const getJWTExpiration = () => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  return isDevelopment ? JWT_EXPIRATION.development : JWT_EXPIRATION.production;
};

interface SessionStartRequest {
  userId?: string;
  email?: string;
  deviceFingerprint: string;
  userAgent?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SessionStartRequest = await request.json();
    const { userId, email, deviceFingerprint, userAgent } = body;

    if (!deviceFingerprint) {
      return NextResponse.json({
        error: 'Device fingerprint is required',
        code: 'DEVICE_FINGERPRINT_REQUIRED'
      }, { status: 400 });
    }

    // Get client IP
    const clientIP = request.ip || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     request.headers.get('x-real-ip') || 
                     'unknown';

    // Require authentication for all users
    if (!userId || !email) {
      return NextResponse.json({
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Please sign in to use the extension'
      }, { status: 401 });
    }

    // CRITICAL FIX: Use UserService for authoritative user lookup
    // This ensures premium_users collection is the authoritative source, not stale custom claims
    let userData;
    
    try {
      // First try by userId, then by email if that fails
      userData = await UserService.getUserById(userId);
      
      if (!userData && email) {
        console.log('🔍 User not found by ID, trying email lookup as fallback:', email);
        userData = await UserService.getUserByEmail(email);
      }
    } catch (error) {
      console.warn('Failed to lookup user with UserService:', error);
    }
    
    if (!userData) {
      return NextResponse.json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
        message: 'User not found in any data source'
      }, { status: 404 });
    }
    
    console.log('✅ Session start using UserService data:', {
      userId: userData.userId,
      email: userData.email,
      subscriptionStatus: userData.subscriptionStatus,
      source: userData.source
    });

    // Note: Removed strict email validation to match auth-status endpoint behavior

    // Create authenticated session using UserService data
    const sessionId = `auth_${userId}_${Date.now()}`;
    const sessionRef = adminDb.collection('sessions').doc(sessionId);
    
    const subscriptionStatus = userData.subscriptionStatus || 'limited';
    
    await sessionRef.set({
      sessionId,
      userId: userData.userId || userId,
      email: userData.email || email,
      subscriptionStatus: subscriptionStatus,
      deviceFingerprint,
      ipAddress: clientIP,
      userAgent: userAgent || request.headers.get('user-agent') || 'unknown',
      startTime: new Date(),
      lastActivity: new Date(),
      lastHeartbeat: new Date(),
      totalUsageTime: 0,
      heartbeatCount: 0,
      status: 'active',
      type: 'authenticated',
      dataSource: userData.source // Track which source provided the user data
    });

    // Generate JWT for authenticated session using UserService data
    const jwt = generateSessionJWT({
      sessionId,
      userId: userData.userId || userId,
      deviceFingerprint,
      ipAddress: clientIP,
      subscriptionStatus: subscriptionStatus
    }, getJWTExpiration());

    console.log('✅ Created authenticated session with UserService data:', {
      sessionId,
      userId: userData.userId,
      subscriptionStatus: subscriptionStatus,
      dataSource: userData.source
    });

    return NextResponse.json({
      success: true,
      sessionType: 'authenticated',
      sessionId,
      token: jwt,
      expiresIn: Math.floor(getJWTExpiration() / 1000),
      subscriptionStatus: subscriptionStatus,
      dailyLimit: subscriptionStatus === 'premium' ? -1 : 3600000, // Unlimited for premium, 1 hour for others
      dataSource: userData.source // Include source in response for debugging
    });

  } catch (error) {
    console.error('Error starting session:', error);
    return NextResponse.json({
      error: 'Failed to start session',
      code: 'SESSION_START_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}