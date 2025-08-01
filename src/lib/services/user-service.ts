/**
 * Unified User Service
 * 
 * Consolidates all user-related database operations to eliminate code duplication
 * across multiple API endpoints. Provides a single source of truth for user data access.
 */

import { adminDb } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export interface UserData {
  userId: string;
  email: string;
  subscriptionStatus: 'free' | 'limited' | 'premium';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;
  deviceFingerprints?: Record<string, any>;
  dailyUsageData?: Record<string, any>;
  preferences?: Record<string, any>;
  metadata?: Record<string, any>;
  source: 'premium_users' | 'users' | 'custom_claims';
}

export interface UserLookupOptions {
  includeCustomClaims?: boolean;
  includeLegacyData?: boolean;
  createIfNotExists?: boolean;
}

export class UserService {
  /**
   * Get user by ID with comprehensive lookup across all user data sources
   */
  static async getUserById(
    userId: string, 
    options: UserLookupOptions = {}
  ): Promise<UserData | null> {
    const {
      includeCustomClaims = true,
      includeLegacyData = true,
      createIfNotExists = false
    } = options;

    // FIRST: Check premium_users collection (AUTHORITATIVE source of truth)
    let premiumUserExists = false;
    try {
      const premiumUserDoc = await adminDb.collection('premium_users').doc(userId).get();
      if (premiumUserDoc.exists) {
        premiumUserExists = true;
        const data = premiumUserDoc.data();
        console.log('✅ Found user in premium_users collection - AUTHORITATIVE:', data?.userId, 'Status:', data?.subscriptionStatus);
        
        // Return immediately - premium_users collection is authoritative
        return {
          userId: data?.userId || userId,
          email: data?.email,
          subscriptionStatus: data?.subscriptionStatus || 'premium',
          stripeCustomerId: data?.stripeCustomerId,
          stripeSubscriptionId: data?.stripeSubscriptionId,
          subscriptionStartDate: data?.subscriptionStartDate?.toDate(),
          subscriptionEndDate: data?.subscriptionEndDate?.toDate(),
          deviceFingerprints: data?.deviceFingerprints,
          dailyUsageData: data?.dailyUsageData,
          preferences: data?.preferences,
          metadata: data?.metadata,
          source: 'premium_users'
        };
      }
    } catch (error) {
      console.warn('Failed to check premium_users collection:', error);
    }

    // SECOND: Check Firebase custom claims (fallback ONLY if not found in premium_users)
    // CRITICAL FIX: Don't check custom claims if user exists in premium_users
    // This prevents stale custom claims from overriding authoritative premium_users data
    if (includeCustomClaims && !premiumUserExists) {
      try {
        const auth = getAuth();
        const userRecord = await auth.getUser(userId);
        const customClaims = userRecord.customClaims || {};
        
        if (customClaims.stripeRole === 'premium' || 
            customClaims.premium === true || 
            customClaims.subscriptionStatus === 'premium') {
          console.log('✅ User has premium custom claims (no premium_users record found)');
          
          return {
            userId: userId,
            email: userRecord.email || '',
            subscriptionStatus: 'premium',
            stripeCustomerId: customClaims.stripeCustomerId,
            stripeSubscriptionId: customClaims.stripeSubscriptionId,
            subscriptionStartDate: customClaims.subscriptionStartDate ? 
              new Date(customClaims.subscriptionStartDate * 1000) : undefined,
            subscriptionEndDate: customClaims.subscriptionEndDate ? 
              new Date(customClaims.subscriptionEndDate * 1000) : undefined,
            source: 'custom_claims'
          };
        }
      } catch (error) {
        console.warn('Failed to get custom claims:', error);
      }
    } else if (premiumUserExists) {
      console.log('🔒 Skipping custom claims check - premium_users collection is authoritative');
    }

    // THIRD: Check legacy users collection
    if (includeLegacyData) {
      try {
        const userDoc = await adminDb.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          console.log('📄 Found user in legacy users collection');
          
          return {
            userId: userId,
            email: data?.email,
            subscriptionStatus: data?.subscriptionStatus || 'free',
            stripeCustomerId: data?.stripeCustomerId,
            stripeSubscriptionId: data?.stripeSubscriptionId,
            subscriptionStartDate: data?.subscriptionStartDate?.toDate(),
            subscriptionEndDate: data?.subscriptionEndDate?.toDate(),
            source: 'users'
          };
        }
      } catch (error) {
        console.warn('Failed to check users collection:', error);
      }
    }

    // If createIfNotExists is true and no user found, create a default user
    if (createIfNotExists) {
      return await this.createUser(userId, '', 'free');
    }

    return null;
  }

  /**
   * Get user by email with comprehensive lookup
   */
  static async getUserByEmail(
    email: string, 
    options: UserLookupOptions = {}
  ): Promise<UserData | null> {
    const { includeLegacyData = true } = options;

    // FIRST: Check premium_users collection by email
    try {
      const emailQuery = await adminDb.collection('premium_users')
        .where('email', '==', email)
        .limit(1)
        .get();
      
      if (!emailQuery.empty) {
        const doc = emailQuery.docs[0];
        const data = doc.data();
        console.log('✅ Found user by email in premium_users collection');
        
        return {
          userId: doc.id,
          email: data.email,
          subscriptionStatus: data.subscriptionStatus || 'premium',
          stripeCustomerId: data.stripeCustomerId,
          stripeSubscriptionId: data.stripeSubscriptionId,
          subscriptionStartDate: data.subscriptionStartDate?.toDate(),
          subscriptionEndDate: data.subscriptionEndDate?.toDate(),
          deviceFingerprints: data.deviceFingerprints,
          dailyUsageData: data.dailyUsageData,
          preferences: data.preferences,
          metadata: data.metadata,
          source: 'premium_users'
        };
      }
    } catch (error) {
      console.warn('Failed to lookup user by email in premium_users:', error);
    }

    // SECOND: Check legacy users collection by email
    if (includeLegacyData) {
      try {
        const querySnapshot = await adminDb.collection('users')
          .where('email', '==', email)
          .limit(1)
          .get();
        
        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const data = doc.data();
          console.log('📄 Found user by email in legacy users collection');
          
          return {
            userId: doc.id,
            email: data.email,
            subscriptionStatus: data.subscriptionStatus || 'free',
            stripeCustomerId: data.stripeCustomerId,
            stripeSubscriptionId: data.stripeSubscriptionId,
            subscriptionStartDate: data.subscriptionStartDate?.toDate(),
            subscriptionEndDate: data.subscriptionEndDate?.toDate(),
            source: 'users'
          };
        }
      } catch (error) {
        console.warn('Failed to lookup user by email in users collection:', error);
      }
    }

    return null;
  }

  /**
   * Create a new user in the appropriate collection
   */
  static async createUser(
    userId: string, 
    email: string, 
    subscriptionStatus: 'free' | 'limited' | 'premium' = 'free'
  ): Promise<UserData> {
    const now = new Date();
    
    // Create in users collection (for non-premium users) or update existing
    const userData = {
      email,
      uid: userId,
      subscriptionStatus,
      subscriptionStartDate: now,
      createdAt: now,
      updatedAt: now
    };

    await adminDb.collection('users').doc(userId).set(userData);
    console.log(`✅ Created user ${userId} with status ${subscriptionStatus}`);
    
    return {
      userId,
      email,
      subscriptionStatus,
      subscriptionStartDate: now,
      source: 'users'
    };
  }

  /**
   * Update user subscription status in the appropriate collection
   */
  static async updateUserSubscription(
    userId: string, 
    subscriptionStatus: 'free' | 'limited' | 'premium',
    additionalData?: Partial<UserData>
  ): Promise<void> {
    const now = new Date();

    // First try to update in premium_users collection
    try {
      const premiumUserDoc = await adminDb.collection('premium_users').doc(userId).get();
      if (premiumUserDoc.exists) {
        await premiumUserDoc.ref.update({
          subscriptionStatus,
          'metadata.updatedAt': now,
          ...additionalData
        });
        console.log(`✅ Updated premium user ${userId} subscription to ${subscriptionStatus}`);
        return;
      }
    } catch (error) {
      console.warn('Failed to update premium_users collection:', error);
    }

    // Fallback to users collection
    try {
      await adminDb.collection('users').doc(userId).update({
        subscriptionStatus,
        updatedAt: now,
        ...additionalData
      });
      console.log(`✅ Updated user ${userId} subscription to ${subscriptionStatus}`);
    } catch (error) {
      console.warn('Failed to update users collection:', error);
      throw error;
    }
  }

  /**
   * Check if user has premium subscription
   */
  static async checkPremiumStatus(userId: string): Promise<boolean> {
    const user = await this.getUserById(userId, { 
      includeCustomClaims: true, 
      includeLegacyData: false 
    });
    
    return user?.subscriptionStatus === 'premium';
  }

  /**
   * Get user with comprehensive error handling
   * Returns user data or throws descriptive error
   */
  static async getUserWithValidation(
    userId?: string, 
    email?: string
  ): Promise<UserData> {
    if (!userId && !email) {
      throw new Error('Either userId or email must be provided');
    }

    let user: UserData | null = null;

    if (userId) {
      user = await this.getUserById(userId);
    } else if (email) {
      user = await this.getUserByEmail(email);
    }

    if (!user) {
      throw new Error(`User not found: ${userId || email}`);
    }

    return user;
  }

  /**
   * Batch user lookup for multiple users
   */
  static async getUsersBatch(userIds: string[]): Promise<(UserData | null)[]> {
    const promises = userIds.map(userId => this.getUserById(userId));
    return Promise.all(promises);
  }

  /**
   * Update user's last access time
   */
  static async updateLastAccess(userId: string): Promise<void> {
    const now = new Date();
    
    // Try premium_users first
    try {
      const premiumUserDoc = await adminDb.collection('premium_users').doc(userId).get();
      if (premiumUserDoc.exists) {
        await premiumUserDoc.ref.update({
          'metadata.lastAccess': now,
          'metadata.updatedAt': now
        });
        return;
      }
    } catch (error) {
      console.warn('Failed to update last access in premium_users:', error);
    }

    // Fallback to users collection
    try {
      await adminDb.collection('users').doc(userId).update({
        lastAccess: now,
        updatedAt: now
      });
    } catch (error) {
      console.warn('Failed to update last access in users:', error);
    }
  }
}