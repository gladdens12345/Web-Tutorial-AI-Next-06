import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId');
  
  if (!userId) {
    return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
  }

  try {
    const auth = getAuth();
    
    // Get current custom claims
    const userRecord = await auth.getUser(userId);
    const currentClaims = userRecord.customClaims || {};
    
    console.log('🧹 Clearing custom claims for user:', userId);
    console.log('🔍 Current claims:', currentClaims);
    
    // Clear premium-related custom claims while preserving other claims
    const cleanedClaims = { ...currentClaims };
    delete cleanedClaims.premium;
    delete cleanedClaims.stripeRole;
    delete cleanedClaims.subscriptionStatus;
    delete cleanedClaims.stripeCustomerId;
    delete cleanedClaims.stripeSubscriptionId;
    delete cleanedClaims.subscriptionStartDate;
    delete cleanedClaims.subscriptionEndDate;
    
    // Set the cleaned claims (Firebase requires setting all claims at once)
    await auth.setCustomUserClaims(userId, cleanedClaims);
    
    console.log('✅ Custom claims cleared for user:', userId);
    console.log('🔍 Remaining claims:', cleanedClaims);
    
    return NextResponse.json({
      success: true,
      userId: userId,
      message: 'Premium-related custom claims cleared successfully',
      clearedClaims: {
        premium: currentClaims.premium,
        stripeRole: currentClaims.stripeRole,
        subscriptionStatus: currentClaims.subscriptionStatus,
        stripeCustomerId: currentClaims.stripeCustomerId,
        stripeSubscriptionId: currentClaims.stripeSubscriptionId,
        subscriptionStartDate: currentClaims.subscriptionStartDate,
        subscriptionEndDate: currentClaims.subscriptionEndDate
      },
      remainingClaims: cleanedClaims,
      instructions: [
        '1. Custom claims have been cleared from Firebase Auth',
        '2. Extension should now use authoritative data sources',
        '3. User may need to clear extension storage and re-authenticate',
        '4. Test authentication with /api/extension/auth-status'
      ]
    });

  } catch (error) {
    console.error('❌ Error clearing custom claims:', error);
    return NextResponse.json({
      error: 'Failed to clear custom claims',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Also support POST method for more complex operations
export async function POST(request: NextRequest) {
  try {
    const { userId, preserveClaims } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'userId required in request body' }, { status: 400 });
    }

    const auth = getAuth();
    
    // Get current custom claims
    const userRecord = await auth.getUser(userId);
    const currentClaims = userRecord.customClaims || {};
    
    console.log('🧹 POST: Clearing custom claims for user:', userId);
    console.log('🔍 Current claims:', currentClaims);
    console.log('🔍 Claims to preserve:', preserveClaims);
    
    // Build cleaned claims - start with preserved claims or empty object
    const cleanedClaims = preserveClaims || {};
    
    // Remove premium-related claims specifically
    const premiumClaimsToRemove = [
      'premium', 'stripeRole', 'subscriptionStatus', 
      'stripeCustomerId', 'stripeSubscriptionId',
      'subscriptionStartDate', 'subscriptionEndDate'
    ];
    
    premiumClaimsToRemove.forEach(claim => {
      delete cleanedClaims[claim];
    });
    
    // Preserve non-premium claims that weren't explicitly set
    if (!preserveClaims) {
      Object.keys(currentClaims).forEach(key => {
        if (!premiumClaimsToRemove.includes(key)) {
          cleanedClaims[key] = currentClaims[key];
        }
      });
    }
    
    // Set the cleaned claims
    await auth.setCustomUserClaims(userId, cleanedClaims);
    
    console.log('✅ POST: Custom claims cleared for user:', userId);
    console.log('🔍 Final claims:', cleanedClaims);
    
    return NextResponse.json({
      success: true,
      userId: userId,
      message: 'Custom claims updated successfully',
      removedClaims: premiumClaimsToRemove.filter(claim => currentClaims[claim] !== undefined),
      finalClaims: cleanedClaims
    });

  } catch (error) {
    console.error('❌ Error in POST clear custom claims:', error);
    return NextResponse.json({
      error: 'Failed to clear custom claims',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}