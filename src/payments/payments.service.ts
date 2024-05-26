import { envs } from '@/config';
import { PaymentSessionDto } from './dto';
import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import Stripe from 'stripe';

@Injectable()
export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecret);

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
    return this.stripe.checkout.sessions.create({
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
      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    switch (event.type) {
      case 'charge.succeeded':
        const chargeSucceded = event.data.object;
        const orderId = chargeSucceded.metadata.orderId;
        console.log({ orderId, sig });
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.sendStatus(200).json({ sig });
  }
}
