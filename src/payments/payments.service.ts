import { envs, NATS_SERVICE } from '@/config';
import { PaymentSessionDto } from './dto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import Stripe from 'stripe';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecret);
  private readonly logger = new Logger(PaymentsService.name);

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  async createPaymentSession({ currency, items, orderId }: PaymentSessionDto) {
    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      };
    });
    const session = await this.stripe.checkout.sessions.create({
      payment_intent_data: {
        metadata: {
          orderId,
        },
      },
      mode: 'payment',
      success_url: envs.successUrl,
      cancel_url: envs.cancelUrl,
      line_items: lineItems,
    });

    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url,
    };
  }

  async stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];
    let event: Stripe.Event;
    const { endpointSecret } = envs;
    try {
      event = this.stripe.webhooks.constructEvent(
        req['rawBody'],
        sig,
        endpointSecret,
      );
    } catch (error) {
      this.logger.error(error);
      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    switch (event.type) {
      case 'charge.succeeded':
        const chargeSucceded = event.data.object;
        const orderId = chargeSucceded.metadata.orderId;
        const payload = {
          orderId,
          stripePaymentId: chargeSucceded.id,
          receiptUrl: chargeSucceded.receipt_url,
        };

        this.client.emit('payment.succeeded', payload);
        break;
      default:
        this.logger.log(`Unhandled event type ${event.type}`);
    }

    return { sig };
  }
}
