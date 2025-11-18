import { NextRequest, NextResponse } from 'next/server';
import { encodeURL, findReference, FindReferenceError } from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import {
  confirmMarketplacePurchase,
  getMarketplaceListingById,
  getMarketplaceListingByReference,
  reserveMarketplaceListingForBuyer,
} from '@/lib/db';

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const USDC_MINT_ADDRESS = process.env.NEXT_PUBLIC_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let parsedUsdcMint: PublicKey | null = null;

try {
  parsedUsdcMint = new PublicKey(USDC_MINT_ADDRESS);
} catch (err) {
  console.error('Invalid NEXT_PUBLIC_USDC_MINT provided:', err);
}

const USDC_MINT = parsedUsdcMint ?? new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

const PURCHASE_PRICE = new BigNumber(0.005);
const DEFAULT_RAKE_BPS = 2000;

function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function calculateRakeTotals(rakeBps: number) {
  const gross = PURCHASE_PRICE;
  const rake = gross.multipliedBy(rakeBps).dividedBy(10_000);
  const seller = gross.minus(rake);
  return {
    gross,
    rake,
    seller,
  };
}

function buildPhantomUrl(paymentUrl: string) {
  return `https://phantom.app/ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`;
}

async function assertUsdcTransfer(
  connection: Connection,
  signature: string,
  recipientWallet: PublicKey,
  expectedAmount: BigNumber,
  reference: PublicKey
) {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta) {
    throw new Error('transaction not found');
  }

  const message = tx.transaction.message;
  let accountKeys: PublicKey[] = [];

  if ('accountKeys' in message) {
    accountKeys = message.accountKeys;
  } else {
    const lookups = message.getAccountKeys({
      accountKeysFromLookups: {
        writable: tx.meta.loadedAddresses?.writable.map((key) => new PublicKey(key)) ?? [],
        readonly: tx.meta.loadedAddresses?.readonly.map((key) => new PublicKey(key)) ?? [],
      },
    });
    accountKeys = [
      ...lookups.staticAccountKeys,
      ...(lookups.accountKeysFromLookups?.writable ?? []),
      ...(lookups.accountKeysFromLookups?.readonly ?? []),
    ];
  }

  const hasReference = accountKeys.some((key) => key.equals(reference));
  if (!hasReference) {
    throw new Error('reference not found');
  }

  const expectedMinor = expectedAmount
    .multipliedBy(new BigNumber(10).pow(USDC_DECIMALS))
    .integerValue(BigNumber.ROUND_FLOOR);

  const postBalances = tx.meta.postTokenBalances ?? [];
  const preBalances = tx.meta.preTokenBalances ?? [];
  const recipientBalances = postBalances.filter(
    (balance) =>
      balance.owner === recipientWallet.toBase58() && balance.mint === USDC_MINT.toBase58()
  );

  if (recipientBalances.length === 0) {
    throw new Error('recipient token balance not found');
  }

  const received = recipientBalances.some((postBalance) => {
    const preBalance = preBalances.find(
      (entry) => entry.accountIndex === postBalance.accountIndex
    );

    const postAmount = new BigNumber(postBalance.uiTokenAmount.amount);
    const preAmount = new BigNumber(preBalance?.uiTokenAmount.amount ?? '0');
    const delta = postAmount.minus(preAmount);

    return delta.gte(expectedMinor);
  });

  if (!received) {
    throw new Error('amount not transferred');
  }
}

export async function POST(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json({ error: 'Project wallet misconfigured' }, { status: 500 });
  }
  if (!parsedUsdcMint) {
    return NextResponse.json({ error: 'USDC mint misconfigured' }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const reference = sanitizeString((body as any).reference, 64);
  const listingId = sanitizeString((body as any).listingId, 64);

  if (reference && listingId) {
    const listing = await getMarketplaceListingByReference(reference, 'purchase');
    if (!listing || listing.id !== listingId) {
      return NextResponse.json({ error: 'Purchase reference not found' }, { status: 404 });
    }

    // If already sold/delivered, return the content
    if (listing.status === 'sold' || (listing.status === 'active' && listing.purchase_signature)) {
      return NextResponse.json({ status: 'delivered', content: listing.content, listing });
    }

    // Allow confirmation if status is 'awaiting_payment' or 'active' (for retries)
    if (listing.status !== 'awaiting_payment' && listing.status !== 'active') {
      return NextResponse.json(
        { status: listing.status, message: 'Listing not available for confirmation' },
        { status: 409 }
      );
    }

    const connection = new Connection(SOLANA_ENDPOINT, 'confirmed');
    const referenceKey = new PublicKey(reference);

    try {
      const { signature } = await findReference(connection, referenceKey, {
        finality: 'confirmed',
      });

      await assertUsdcTransfer(
        connection,
        signature,
        new PublicKey(PROJECT_WALLET),
        PURCHASE_PRICE,
        referenceKey
      );

      const rakeBps = listing.rake_bps ?? DEFAULT_RAKE_BPS;
      const { rake, seller } = calculateRakeTotals(rakeBps);

      const updated = await confirmMarketplacePurchase({
        listingId: listing.id,
        signature,
        rakeAmount: rake.toFixed(6),
        sellerAmount: seller.toFixed(6),
        keepActive: true, // Keep listing active for multiple purchases
        buyerAgentId: listing.buyer_agent_id,
        buyerWallet: listing.buyer_wallet ?? undefined,
        purchaseReference: listing.purchase_reference ?? undefined,
      });

      return NextResponse.json(
        {
          status: 'delivered',
          content: updated?.content,
          listing: updated,
        },
        {
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    } catch (err) {
      if (err instanceof FindReferenceError) {
        return NextResponse.json({ status: 'pending' }, { status: 402 });
      }
      console.error('Marketplace purchase validation failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ 
        error: 'Validation failed',
        details: errorMessage 
      }, { status: 422 });
    }
  }

  const buyerAgentId = sanitizeString((body as any).buyerAgentId, 64) || 'buyer';
  const buyerWallet = sanitizeString((body as any).buyerWallet, 64);

  if (!listingId) {
    return NextResponse.json({ error: 'listingId required' }, { status: 400 });
  }
  if (!buyerWallet) {
    return NextResponse.json({ error: 'buyerWallet required' }, { status: 400 });
  }

  const listing = await getMarketplaceListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  if (listing.status !== 'active') {
    return NextResponse.json(
      { error: 'Listing not available', status: listing.status },
      { status: 409 }
    );
  }

  const purchaseReference = Keypair.generate().publicKey.toBase58();
  const updated = await reserveMarketplaceListingForBuyer({
    listingId: listing.id,
    buyerAgentId,
    buyerWallet,
    purchaseReference,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const paymentFields: any = {
    recipient: new PublicKey(PROJECT_WALLET),
    amount: PURCHASE_PRICE,
    splToken: USDC_MINT,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    reference: new PublicKey(purchaseReference),
    label: 'SolAI Marketplace Purchase',
    message: `${listing.title} purchase`,
    memo: listing.id,
  };

  const paymentUrl = encodeURL(paymentFields).toString();

  return NextResponse.json(
    {
      listingId: listing.id,
      reference: purchaseReference,
      amount: PURCHASE_PRICE.toFixed(3),
      paymentUrl,
      phantomUrl: buildPhantomUrl(paymentUrl),
    },
    {
      status: 402,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}


