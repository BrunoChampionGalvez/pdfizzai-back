import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { User } from '../entities/user.entity';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionUsage } from '../entities/subscription-usage.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(SubscriptionPlan)
    private subscriptionPlanRepository: Repository<SubscriptionPlan>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SubscriptionUsage)
    private subscriptionUsageRepository: Repository<SubscriptionUsage>,
  ) {}

  async seedDatabase() {
    this.logger.log('Starting database seeding...');

    try {
      // Seed subscription plans
      await this.seedSubscriptionPlans();
      
      // Seed demo user
      await this.seedDemoUser();

      this.logger.log('Database seeding completed successfully');
    } catch (error) {
      this.logger.error('Error during database seeding:', error);
      throw error;
    }
  }

  private async seedSubscriptionPlans() {
    this.logger.log('Seeding subscription plans...');

    // Check if plans already exist
    const existingPlansCount = await this.subscriptionPlanRepository.count();
    if (existingPlansCount > 0) {
      this.logger.log('Subscription plans already exist, skipping seeding');
      return;
    }

    const plans = [
      {
        name: 'Starter',
        price: 490, // $4.90 in cents
        currency: 'USD',
        frequency: 1, // Monthly
        messagesLimit: 100,
        trialMessagesLimit: 20,
        filePagesLimit: 500,
        trialFilePagesLimit: 50,
        monthlyPaddlePriceId: undefined,
        monthlyPaddlePriceIdWithTrial: undefined,
        yearlyPaddlePriceId: undefined,
        yearlyPaddlePriceIdWithTrial: undefined,
        paddleProductId: undefined,
      },
      {
        name: 'Pro',
        price: 990, // $9.90 in cents
        currency: 'USD',
        frequency: 1, // Monthly
        messagesLimit: 500,
        trialMessagesLimit: 20,
        filePagesLimit: 2000,
        trialFilePagesLimit: 50,
        monthlyPaddlePriceId: undefined,
        monthlyPaddlePriceIdWithTrial: undefined,
        yearlyPaddlePriceId: undefined,
        yearlyPaddlePriceIdWithTrial: undefined,
        paddleProductId: undefined,
      },
      {
        name: 'Plus',
        price: 1990, // $19.90 in cents
        currency: 'USD',
        frequency: 1, // Monthly
        messagesLimit: -1, // Unlimited
        trialMessagesLimit: 20,
        filePagesLimit: -1, // Unlimited
        trialFilePagesLimit: 50,
        monthlyPaddlePriceId: undefined,
        monthlyPaddlePriceIdWithTrial: undefined,
        yearlyPaddlePriceId: undefined,
        yearlyPaddlePriceIdWithTrial: undefined,
        paddleProductId: undefined,
      },
    ];

    for (const planData of plans) {
      const plan = this.subscriptionPlanRepository.create(planData);
      await this.subscriptionPlanRepository.save(plan);
      this.logger.log(`Created subscription plan: ${plan.name} - Price: $${plan.price}`);
    }

    this.logger.log('Subscription plans seeded successfully');
  }

  private async seedDemoUser() {
    this.logger.log('Seeding demo user...');

    // Check if demo user already exists
    const existingDemoUser = await this.userRepository.findOne({
      where: { email: 'demo@mail.com' },
    });

    if (existingDemoUser) {
      this.logger.log('Demo user already exists, skipping seeding');
      return;
    }

    // Get Starter plan
    const starterPlan = await this.subscriptionPlanRepository.findOne({
      where: { name: 'Starter' },
    });

    if (!starterPlan) {
      this.logger.error('Starter plan not found, cannot create demo user');
      throw new Error('Starter plan not found');
    }

    // Hash password
    const passwordHash = await bcrypt.hash('Test*1234!', 10);

    // Create demo user
    const demoUser = this.userRepository.create({
      email: 'demo@mail.com',
      password_hash: passwordHash,
      name: 'Demo User',
      country: 'US',
    });

    await this.userRepository.save(demoUser);
    this.logger.log('Demo user created successfully');

    // Create subscription for demo user
    const subscription = this.subscriptionRepository.create({
      user: demoUser,
      plan: starterPlan,
      status: 'active',
      name: 'Starter Plan',
      type: 'subscription',
      hasFullAccess: true,
      hasTrialPeriod: false,
      scheduledCancel: false,
      createdAt: new Date(),
    });

    await this.subscriptionRepository.save(subscription);
    this.logger.log('Demo user subscription created successfully');

    // Create subscription usage for demo user
    const usage = this.subscriptionUsageRepository.create({
      subscription: subscription,
      messagesUsed: 0,
      filePagesUploaded: 0,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    });

    await this.subscriptionUsageRepository.save(usage);
    this.logger.log('Demo user subscription usage created successfully');
  }
}
