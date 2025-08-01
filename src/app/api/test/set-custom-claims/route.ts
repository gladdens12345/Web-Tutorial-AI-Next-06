import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // SECURITY: Disable in production to prevent unauthorized premium access
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ 
      error: 'Test endpoint disabled in production for security' 
    }, { status: 404 });
  }
  
  const userId = request.nextUrl.searchParams.get('userId');
  
  if (!userId) {
    return NextResponse.json({ error: 'userId parameter required' }, { status: 400 });
  }

  try {
    console.log('🧪 Setting custom claims for user:', userId);
    
    const auth = getAuth();
    await auth.setCustomUserClaims(userId, {
      premium: true,
      subscriptionStatus: 'premium',
      stripeCustomerId: 'manual_upgrade',
      stripeSubscriptionId: 'manual_upgrade',
      subscriptionStartDate: Math.floor(Date.now() / 1000),
      subscriptionEndDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days from now
      updatedAt: Date.now()
    });
    
    console.log('✅ Custom claims set successfully for user:', userId);

    return NextResponse.json({
      success: true,
      message: `Custom claims set for user ${userId}`,
      timestamp: new Date().toISOString(),
      claims: {
        premium: true,
        subscriptionStatus: 'premium'
      }
    });

  } catch (error) {
    console.error('❌ Failed to set custom claims:', error);
    return NextResponse.json({
      error: 'Failed to set custom claims',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}