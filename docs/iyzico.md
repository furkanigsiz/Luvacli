# iyzico Ödeme Entegrasyonu

## Kurulum
```bash
npm install iyzipay
```

## Konfigürasyon
```typescript
// .env dosyasına ekle
IYZICO_API_KEY=your_api_key
IYZICO_SECRET_KEY=your_secret_key
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com  // Test için sandbox

// src/config/iyzico.ts
import Iyzipay from 'iyzipay';

export const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY!,
  secretKey: process.env.IYZICO_SECRET_KEY!,
  uri: process.env.IYZICO_BASE_URL!
});
```

## Temel Ödeme (Non-3D)
```typescript
import { iyzipay } from './config/iyzico';

interface PaymentRequest {
  price: string;
  paidPrice: string;
  currency: 'TRY' | 'USD' | 'EUR';
  basketId: string;
  paymentCard: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvc: string;
  };
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    identityNumber: string;
    registrationAddress: string;
    city: string;
    country: string;
    ip: string;
  };
  shippingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  basketItems: Array<{
    id: string;
    name: string;
    category1: string;
    itemType: 'PHYSICAL' | 'VIRTUAL';
    price: string;
  }>;
}

export async function createPayment(data: PaymentRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = {
      locale: 'tr',
      conversationId: Date.now().toString(),
      price: data.price,
      paidPrice: data.paidPrice,
      currency: Iyzipay.CURRENCY[data.currency],
      installment: '1',
      basketId: data.basketId,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      paymentCard: {
        cardHolderName: data.paymentCard.cardHolderName,
        cardNumber: data.paymentCard.cardNumber,
        expireMonth: data.paymentCard.expireMonth,
        expireYear: data.paymentCard.expireYear,
        cvc: data.paymentCard.cvc,
        registerCard: '0'
      },
      buyer: {
        id: data.buyer.id,
        name: data.buyer.name,
        surname: data.buyer.surname,
        gsmNumber: '+905350000000',
        email: data.buyer.email,
        identityNumber: data.buyer.identityNumber,
        lastLoginDate: new Date().toISOString().split('T')[0] + ' 12:00:00',
        registrationDate: '2020-01-01 12:00:00',
        registrationAddress: data.buyer.registrationAddress,
        ip: data.buyer.ip,
        city: data.buyer.city,
        country: data.buyer.country,
        zipCode: '34000'
      },
      shippingAddress: {
        contactName: data.shippingAddress.contactName,
        city: data.shippingAddress.city,
        country: data.shippingAddress.country,
        address: data.shippingAddress.address,
        zipCode: '34000'
      },
      billingAddress: {
        contactName: data.billingAddress.contactName,
        city: data.billingAddress.city,
        country: data.billingAddress.country,
        address: data.billingAddress.address,
        zipCode: '34000'
      },
      basketItems: data.basketItems.map(item => ({
        id: item.id,
        name: item.name,
        category1: item.category1,
        category2: 'Genel',
        itemType: Iyzipay.BASKET_ITEM_TYPE[item.itemType],
        price: item.price
      }))
    };

    iyzipay.payment.create(request, (err: any, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
```

## 3D Secure Ödeme
```typescript
// 3D Secure başlatma
export async function init3DPayment(data: PaymentRequest, callbackUrl: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = {
      locale: 'tr',
      conversationId: Date.now().toString(),
      price: data.price,
      paidPrice: data.paidPrice,
      currency: Iyzipay.CURRENCY[data.currency],
      installment: '1',
      basketId: data.basketId,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl: callbackUrl,
      paymentCard: data.paymentCard,
      buyer: data.buyer,
      shippingAddress: data.shippingAddress,
      billingAddress: data.billingAddress,
      basketItems: data.basketItems
    };

    iyzipay.threedsInitialize.create(request, (err: any, result: any) => {
      if (err) reject(err);
      else resolve(result); // result.threeDSHtmlContent içinde 3D form var
    });
  });
}

// 3D Callback sonrası ödemeyi tamamla
export async function complete3DPayment(paymentId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = {
      locale: 'tr',
      conversationId: Date.now().toString(),
      paymentId: paymentId
    };

    iyzipay.threedsPayment.create(request, (err: any, result: any) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}
```

## React Component Örneği
```tsx
// components/PaymentForm.tsx
import { useState } from 'react';

interface PaymentFormProps {
  amount: number;
  onSuccess: (result: any) => void;
  onError: (error: any) => void;
}

export function PaymentForm({ amount, onSuccess, onError }: PaymentFormProps) {
  const [loading, setLoading] = useState(false);
  const [cardData, setCardData] = useState({
    cardHolderName: '',
    cardNumber: '',
    expireMonth: '',
    expireYear: '',
    cvc: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await fetch('/api/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          card: cardData
        })
      });
      
      const result = await response.json();
      
      if (result.status === 'success') {
        onSuccess(result);
      } else {
        onError(result.errorMessage);
      }
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        placeholder="Kart Üzerindeki İsim"
        value={cardData.cardHolderName}
        onChange={e => setCardData({...cardData, cardHolderName: e.target.value})}
        className="w-full p-2 border rounded"
      />
      <input
        type="text"
        placeholder="Kart Numarası"
        value={cardData.cardNumber}
        onChange={e => setCardData({...cardData, cardNumber: e.target.value})}
        className="w-full p-2 border rounded"
      />
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Ay"
          value={cardData.expireMonth}
          onChange={e => setCardData({...cardData, expireMonth: e.target.value})}
          className="w-1/3 p-2 border rounded"
        />
        <input
          type="text"
          placeholder="Yıl"
          value={cardData.expireYear}
          onChange={e => setCardData({...cardData, expireYear: e.target.value})}
          className="w-1/3 p-2 border rounded"
        />
        <input
          type="text"
          placeholder="CVC"
          value={cardData.cvc}
          onChange={e => setCardData({...cardData, cvc: e.target.value})}
          className="w-1/3 p-2 border rounded"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full p-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'İşleniyor...' : `${amount} TL Öde`}
      </button>
    </form>
  );
}
```

## API Route (Next.js)
```typescript
// app/api/payment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createPayment } from '@/lib/iyzico';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const result = await createPayment({
      price: body.amount.toString(),
      paidPrice: body.amount.toString(),
      currency: 'TRY',
      basketId: `basket_${Date.now()}`,
      paymentCard: body.card,
      buyer: {
        id: body.userId || 'guest',
        name: body.card.cardHolderName.split(' ')[0],
        surname: body.card.cardHolderName.split(' ').slice(1).join(' '),
        email: body.email,
        identityNumber: '11111111111',
        registrationAddress: body.address,
        city: body.city || 'Istanbul',
        country: 'Turkey',
        ip: req.headers.get('x-forwarded-for') || '127.0.0.1'
      },
      shippingAddress: {
        contactName: body.card.cardHolderName,
        city: body.city || 'Istanbul',
        country: 'Turkey',
        address: body.address
      },
      billingAddress: {
        contactName: body.card.cardHolderName,
        city: body.city || 'Istanbul',
        country: 'Turkey',
        address: body.address
      },
      basketItems: body.items || [{
        id: 'item1',
        name: 'Ürün',
        category1: 'Genel',
        itemType: 'PHYSICAL',
        price: body.amount.toString()
      }]
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

## Test Kartları
| Kart No | Sonuç |
|---------|-------|
| 5528790000000008 | Başarılı |
| 5528790000000016 | Başarısız |
| 4603450000000000 | 3D Secure |

CVV: 123, Son Kullanma: Gelecek herhangi bir tarih

## Önemli Notlar
- Sandbox URL: https://sandbox-api.iyzipay.com
- Production URL: https://api.iyzipay.com
- Tüm fiyatlar kuruş değil TL cinsinden (örn: "100.00")
- basketItems toplamı paidPrice'a eşit olmalı
- identityNumber 11 haneli TC kimlik no (test için 11111111111)
