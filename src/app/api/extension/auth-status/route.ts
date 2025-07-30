import { NextRequest, NextResponse } from 'next/server';
import { UserService } from '@/lib/services/user-service';

// Force dynamic rendering to prevent static caching
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Safely parse JSON with validation
    let requestBody;
    try {
      const requestText = await request.text();
      console.log('🔍 Auth-status request body:', requestText);
      
      if (!requestText || requestText.trim() === '') {
        console.log('⚠️ Empty request body received');
        requestBody = {};
      } else {
        requestBody = JSON.parse(requestText);
      }
    } catch (parseError) {
      console.error('❌ JSON parsing error:', parseError, 'Raw body:', await request.text());
      return NextResponse.json(
        { 
          error: 'Invalid JSON in request body',
          subscriptionStatus: 'error',
          canUse: false,
          reason: 'invalid_request',
          timeRemaining: 0,
          hasKnowledgeBase: false
        },
        { status: 400 }
      );
    }
    
    const { userEmail, userId } = requestBody;

    if (!userEmail && !userId) {
      return NextResponse.json({ 
        error: 'Authentication required',
        subscriptionStatus: 'unauthenticated',
        canUse: false,
        reason: 'authentication_required',
        timeRemaining: 0,
        hasKnowledgeBase: false
      }, { status: 401 });
    }

    // Use unified UserService for all user lookup operations
    let userData = null;

    try {
      if (userId) {
        userData = await UserService.getUserById(userId);
        if (userData) {
          // Update last access time
          await UserService.updateLastAccess(userId);
        }
      } else if (userEmail) {
        userData = await UserService.getUserByEmail(userEmail);
        if (userData) {
          // Update last access time
          await UserService.updateLastAccess(userData.userId);
        }
      }
    } catch (error) {
      console.warn('Failed to lookup user:', error);
    }
    
    if (!userData) {
      return NextResponse.json({
        subscriptionStatus: 'limited',
        canUse: true,
        reason: 'limited_daily_access',
        timeRemaining: 3600000, // 1 hour for production
        hasKnowledgeBase: false
      });
    }

    return buildResponse(userData);

  } catch (error) {
    console.error('Error checking extension auth status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check authentication status',
        subscriptionStatus: 'error',
        canUse: false,
        reason: 'server_error',
        timeRemaining: 0,
        hasKnowledgeBase: false
      },
      { status: 500 }
    );
  }
}

interface UserData {
  subscriptionStatus?: string;
  subscriptionEndDate?: Date | { toDate: () => Date } | string;
}

function buildResponse(userData: UserData) {
  const subscriptionStatus = userData.subscriptionStatus || 'limited';
  const now = new Date();
  
  console.log('🔍 USER DATA DEBUG:', {
    subscriptionStatus: userData.subscriptionStatus,
    hasEndDate: !!userData.subscriptionEndDate,
    endDate: userData.subscriptionEndDate,
    finalStatus: subscriptionStatus
  });
  
  // Convert any legacy trial status to limited (1 hour daily)
  if (subscriptionStatus === 'trial') {
    console.log('🔍 Converting legacy trial status to limited');
    return NextResponse.json({
      subscriptionStatus: 'limited',
      canUse: true,
      reason: 'trial_expired_limited_access',
      timeRemaining: 3600000, // 1 hour for production
      hasKnowledgeBase: false,
      trialExpired: true,
      requiresSubscription: false
    });
  }

  // Check subscription status and return appropriate limits
  switch (subscriptionStatus) {
    case 'premium':
      return NextResponse.json({
        subscriptionStatus: 'premium',
        canUse: true,
        reason: 'premium_unlimited',
        timeRemaining: -1, // Unlimited
        hasKnowledgeBase: true,
        subscriptionEndDate: userData.subscriptionEndDate
      });
      
    case 'limited':
    default:
      // Limited users get 1 hour daily access
      return NextResponse.json({
        subscriptionStatus: 'limited',
        canUse: true,
        reason: 'limited_daily_access',
        timeRemaining: 3600000, // 1 hour for production
        hasKnowledgeBase: false,
        requiresSubscription: false
      });
  }
}

