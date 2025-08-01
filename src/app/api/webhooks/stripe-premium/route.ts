/**
 * Stripe Webhook Handler for Premium Users
 * 
 * Automatically creates/updates premium_users records when Stripe events occur
 * Works alongside the existing Firebase Stripe Extension
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminDb } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import Stripe from 'stripe';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headersList = headers();
    const signature = headersList.get('stripe-signature');

    if (!signature) {
      console.error('❌ Missing Stripe signature');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      const error = err as Error;
      console.error('❌ Webhook signature verification failed:', error.message);
      return NextResponse.json({ 
        error: `Webhook Error: ${error.message}` 
      }, { status: 400 });
    }

    console.log('🎣 Stripe webhook received:', event.type);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`⚠️ Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });

  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    return NextResponse.json({
      error: 'Webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * Handle successful checkout completion
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('🎉 Processing checkout completion:', session.id);

  try {
    // Get customer and subscription details
    const customerId = session.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    
    // Get the subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    const subscription = subscriptions.data[0];
    if (!subscription) {
      console.warn('⚠️ No active subscription found for customer:', customerId);
      return;
    }

    // Extract user information
    const email = customer.email || session.customer_details?.email;
    if (!email) {
      console.error('❌ No email found for customer:', customerId);
      return;
    }

    // Find the user by email
    let userId: string | null = null;
    try {
      const auth = getAuth();
      const userRecord = await auth.getUserByEmail(email);
      userId = userRecord.uid;
    } catch (error) {
      console.warn('⚠️ User not found by email, checking metadata:', email);
      
      // Check if userId is in session metadata
      if (session.metadata?.userId) {
        userId = session.metadata.userId;
      }
    }

    if (!userId) {
      console.error('❌ Cannot find userId for email:', email);
      return;
    }

    // Create premium user record
    await createPremiumUserRecord({
      userId,
      email,
      customerId,
      subscription,
      source: 'checkout_completed'
    });

    console.log('✅ Premium user created from checkout completion:', userId);

  } catch (error) {
    console.error('❌ Error processing checkout completion:', error);
  }
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log('🔄 Processing subscription creation:', subscription.id);

  try {
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    
    const email = customer.email;
    if (!email) {
      console.error('❌ No email found for customer:', customerId);
      return;
    }

    // Find user by email
    let userId: string | null = null;
    try {
      const auth = getAuth();
      const userRecord = await auth.getUserByEmail(email);
      userId = userRecord.uid;
    } catch (error) {
      console.warn('⚠️ User not found by email:', email);
      return;
    }

    if (!userId) return;

    await createPremiumUserRecord({
      userId,
      email,
      customerId,
      subscription,
      source: 'subscription_created'
    });

    console.log('✅ Premium user created from subscription creation:', userId);

  } catch (error) {
    console.error('❌ Error processing subscription creation:', error);
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('🔄 Processing subscription update:', subscription.id);

  try {
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    
    const email = customer.email;
    if (!email) return;

    // Find user by email
    let userId: string | null = null;
    try {
      const auth = getAuth();
      const userRecord = await auth.getUserByEmail(email);
      userId = userRecord.uid;
    } catch (error) {
      return;
    }

    if (!userId) return;

    // Update subscription status based on Stripe status
    const subscriptionStatus = subscription.status === 'active' ? 'premium' : 'limited';

    await updatePremiumUserRecord(userId, {
      subscriptionStatus,
      stripeSubscriptionId: subscription.id,
      subscriptionEndDate: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      source: 'subscription_updated'
    });

    console.log('✅ Premium user updated from subscription update:', userId);

  } catch (error) {
    console.error('❌ Error processing subscription update:', error);
  }
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('🗑️ Processing subscription deletion:', subscription.id);

  try {
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    
    const email = customer.email;
    if (!email) return;

    // Find user by email
    let userId: string | null = null;
    try {
      const auth = getAuth();
      const userRecord = await auth.getUserByEmail(email);
      userId = userRecord.uid;
    } catch (error) {
      return;
    }

    if (!userId) return;

    // Downgrade to limited status
    await updatePremiumUserRecord(userId, {
      subscriptionStatus: 'limited',
      subscriptionEndDate: new Date(subscription.canceled_at! * 1000),
      source: 'subscription_deleted'
    });

    console.log('✅ Premium user downgraded from subscription deletion:', userId);

  } catch (error) {
    console.error('❌ Error processing subscription deletion:', error);
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('💰 Processing payment success:', invoice.id);

  try {
    if (!invoice.subscription) return;

    const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    
    const email = customer.email;
    if (!email) return;

    let userId: string | null = null;
    try {
      const auth = getAuth();
      const userRecord = await auth.getUserByEmail(email);
      userId = userRecord.uid;
    } catch (error) {
      return;
    }

    if (!userId) return;

    // Ensure user is premium after successful payment
    await updatePremiumUserRecord(userId, {
      subscriptionStatus: 'premium',
      source: 'payment_succeeded'
    });

    console.log('✅ Premium status confirmed after payment success:', userId);

  } catch (error) {
    console.error('❌ Error processing payment success:', error);
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  console.log('💸 Processing payment failure:', invoice.id);
  // For now, we'll just log it. You might want to send notifications or update status
}

/**
 * Create a premium user record
 */
async function createPremiumUserRecord({
  userId,
  email,
  customerId,
  subscription,
  source
}: {
  userId: string;
  email: string;
  customerId: string;
  subscription: Stripe.Subscription;
  source: string;
}) {
  const priceId = subscription.items.data[0]?.price.id;
  
  const premiumUserData = {
    userId,
    email,
    subscriptionStatus: 'premium' as const,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    subscriptionStartDate: new Date(subscription.created * 1000),
    subscriptionEndDate: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    subscriptionPriceId: priceId,
    deviceFingerprints: {},
    dailyUsageData: {},
    preferences: {
      theme: 'light',
      ttsEnabled: true,
      language: 'en'
    },
    metadata: {
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccess: new Date(),
      version: 1,
      source: source
    }
  };

  // Write to premium_users collection
  await adminDb.collection('premium_users').doc(userId).set(premiumUserData, { merge: true });

  // Set Firebase custom claims for backward compatibility
  try {
    const auth = getAuth();
    await auth.setCustomUserClaims(userId, {
      subscriptionStatus: 'premium',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      premium: true,
      stripeRole: 'premium'
    });
  } catch (error) {
    console.warn('⚠️ Failed to set custom claims:', error);
  }
}

/**
 * Update existing premium user record
 */
async function updatePremiumUserRecord(userId: string, updates: any) {
  const updateData = {
    ...updates,
    'metadata.updatedAt': new Date(),
    'metadata.lastAccess': new Date()
  };

  await adminDb.collection('premium_users').doc(userId).update(updateData);

  // Update custom claims if subscription status changed
  if (updates.subscriptionStatus) {
    try {
      const auth = getAuth();
      
      if (updates.subscriptionStatus === 'premium') {
        // Set premium claims
        await auth.setCustomUserClaims(userId, {
          subscriptionStatus: 'premium',
          premium: true,
          stripeRole: 'premium'
        });
        console.log('✅ Set premium custom claims for user:', userId);
      } else {
        // CRITICAL FIX: Completely clear premium-related custom claims
        // Get current claims first
        const userRecord = await auth.getUser(userId);
        const currentClaims = userRecord.customClaims || {};
        
        // Remove premium-related claims while preserving others
        const cleanedClaims = { ...currentClaims };
        delete cleanedClaims.premium;
        delete cleanedClaims.stripeRole;
        delete cleanedClaims.subscriptionStatus;
        delete cleanedClaims.stripeCustomerId;
        delete cleanedClaims.stripeSubscriptionId;
        delete cleanedClaims.subscriptionStartDate;
        delete cleanedClaims.subscriptionEndDate;
        
        await auth.setCustomUserClaims(userId, cleanedClaims);
        console.log('✅ Cleared premium custom claims for user:', userId);
      }
    } catch (error) {
      console.warn('⚠️ Failed to update custom claims:', error);
    }
  }
}