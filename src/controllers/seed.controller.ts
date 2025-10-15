import { Controller, Post, Get } from '@nestjs/common';
import { SeedService } from '../services/seed.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';

@Controller('api/seed')
export class SeedController {
  constructor(
    private readonly seedService: SeedService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(SubscriptionPlan)
    private planRepository: Repository<SubscriptionPlan>,
  ) {}

  @Post('run')
  async runSeeder() {
    try {
      await this.seedService.seedDatabase();
      return { 
        success: true, 
        message: 'Database seeded successfully' 
      };
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        error: error.stack 
      };
    }
  }

  @Get('status')
  async checkStatus() {
    const demoUser = await this.userRepository.findOne({
      where: { email: 'demo@mail.com' },
      relations: ['subscriptions', 'subscriptions.plan'],
    });

    const plans = await this.planRepository.find();

    return {
      demoUserExists: !!demoUser,
      demoUser: demoUser ? {
        id: demoUser.id,
        email: demoUser.email,
        name: demoUser.name,
        subscriptions: demoUser.subscriptions?.length || 0,
      } : null,
      plansCount: plans.length,
      plans: plans.map(p => ({ id: p.id, name: p.name, price: p.price })),
    };
  }

  @Post('update-prices')
  async updatePrices() {
    try {
      const priceMap = {
        'Starter': 490,  // $4.90 in cents
        'Pro': 990,      // $9.90 in cents
        'Plus': 1990,    // $19.90 in cents
      };

      const plans = await this.planRepository.find();
      
      for (const plan of plans) {
        if (priceMap[plan.name]) {
          plan.price = priceMap[plan.name];
          await this.planRepository.save(plan);
        }
      }

      const updatedPlans = await this.planRepository.find();

      return {
        success: true,
        message: 'Prices updated successfully',
        plans: updatedPlans.map(p => ({ name: p.name, price: p.price, priceUSD: `$${(p.price / 100).toFixed(2)}` })),
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        error: error.stack,
      };
    }
  }

  @Post('reset')
  async resetDatabase() {
    try {
      // Delete all data in order (due to foreign key constraints)
      await this.userRepository.query('TRUNCATE TABLE subscription_usages CASCADE');
      await this.userRepository.query('TRUNCATE TABLE subscriptions CASCADE');
      await this.userRepository.query('TRUNCATE TABLE subscription_plans CASCADE');
      await this.userRepository.query('TRUNCATE TABLE users CASCADE');

      // Run seeder again
      await this.seedService.seedDatabase();

      const plans = await this.planRepository.find();
      const demoUser = await this.userRepository.findOne({
        where: { email: 'demo@mail.com' },
      });

      return {
        success: true,
        message: 'Database reset and reseeded successfully',
        demoUserCreated: !!demoUser,
        plans: plans.map(p => ({ name: p.name, price: p.price })),
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        error: error.stack,
      };
    }
  }
}
