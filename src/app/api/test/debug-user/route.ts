import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { UserService } from '@/lib/services/user-service';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const userId = request.nextUrl.searchParams.get('userId');
  
  if (!email && !userId) {
    return NextResponse.json({ error: 'email or userId parameter required' }, { status: 400 });
  }

  try {
    console.log('🔍 DEBUG USER LOOKUP:', { email, userId });
    
    // Use UserService to get authoritative user data
    let userData = null;
    let actualUserId = userId;
    
    if (userId) {
      userData = await UserService.getUserById(userId);
    } else if (email) {
      userData = await UserService.getUserByEmail(email);
      actualUserId = userData?.userId;
    }
    
    // Also get raw data from all sources for debugging
    const debugData: any = {
      email: email || userData?.email,
      userId: actualUserId,
      userServiceResult: userData,
      sources: {}
    };
    
    // 1. Check premium_users collection
    if (actualUserId) {
      try {
        const premiumDoc = await adminDb.collection('premium_users').doc(actualUserId).get();
        debugData.sources.premium_users = premiumDoc.exists ? {
          exists: true,
          data: premiumDoc.data()
        } : { exists: false };
      } catch (error) {
        debugData.sources.premium_users = { error: error.message };
      }
    }
    
    // 2. Check Firebase custom claims
    if (actualUserId) {
      try {
        const auth = getAuth();
        const userRecord = await auth.getUser(actualUserId);
        debugData.sources.custom_claims = {
          exists: true,
          claims: userRecord.customClaims || {},
          email: userRecord.email
        };
      } catch (error) {
        debugData.sources.custom_claims = { error: error.message };
      }
    }
    
    // 3. Check legacy users collection
    if (actualUserId) {
      try {
        const userDoc = await adminDb.collection('users').doc(actualUserId).get();
        debugData.sources.users = userDoc.exists ? {
          exists: true,
          data: userDoc.data()
        } : { exists: false };
      } catch (error) {
        debugData.sources.users = { error: error.message };
      }
    }
    
    // 4. Check by email in premium_users
    if (email && !debugData.sources.premium_users?.exists) {
      try {
        const emailQuery = await adminDb.collection('premium_users')
          .where('email', '==', email)
          .limit(1)
          .get();
        
        debugData.sources.premium_users_by_email = emailQuery.empty ? {
          exists: false
        } : {
          exists: true,
          data: emailQuery.docs[0].data(),
          docId: emailQuery.docs[0].id
        };
      } catch (error) {
        debugData.sources.premium_users_by_email = { error: error.message };
      }
    }
    
    // Determine which source would be used by the auth system
    let authSource = 'none';
    let authStatus = 'limited';
    
    if (debugData.sources.premium_users?.exists) {
      authSource = 'premium_users';
      authStatus = debugData.sources.premium_users.data?.subscriptionStatus || 'premium';
    } else if (debugData.sources.premium_users_by_email?.exists) {
      authSource = 'premium_users_by_email';
      authStatus = debugData.sources.premium_users_by_email.data?.subscriptionStatus || 'premium';
    } else if (debugData.sources.custom_claims?.claims && 
               (debugData.sources.custom_claims.claims.premium === true ||
                debugData.sources.custom_claims.claims.stripeRole === 'premium' ||
                debugData.sources.custom_claims.claims.subscriptionStatus === 'premium')) {
      authSource = 'custom_claims';
      authStatus = 'premium';
    } else if (debugData.sources.users?.exists) {
      authSource = 'users';
      authStatus = debugData.sources.users.data?.subscriptionStatus || 'free';
    }
    
    // Check for stale custom claims (the main issue)
    const hasStaleCustomClaims = debugData.sources.custom_claims?.claims && 
      (debugData.sources.custom_claims.claims.premium === true ||
       debugData.sources.custom_claims.claims.stripeRole === 'premium' ||
       debugData.sources.custom_claims.claims.subscriptionStatus === 'premium') &&
      authSource !== 'custom_claims'; // User exists in more authoritative source
    
    return NextResponse.json({
      success: true,
      summary: {
        finalAuthSource: authSource,
        finalAuthStatus: authStatus,
        hasStaleCustomClaims: hasStaleCustomClaims,
        userServiceSource: userData?.source,
        userServiceStatus: userData?.subscriptionStatus
      },
      debugData,
      actions: hasStaleCustomClaims ? {
        clearCustomClaims: `/api/test/clear-custom-claims?userId=${actualUserId}`,
        description: 'This user has stale custom claims that need to be cleared'
      } : null,
      upgradeUrl: actualUserId ? `https://webtutorialai.com/api/test/set-custom-claims?userId=${actualUserId}` : null
    });

  } catch (error) {
    console.error('❌ Error in debug user lookup:', error);
    return NextResponse.json({
      error: 'Failed to lookup user',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}