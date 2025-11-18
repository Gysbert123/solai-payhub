import { NextRequest, NextResponse } from 'next/server';
import { encodeURL, findReference, FindReferenceError } from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  activateMarketplaceListing,
  createMarketplaceListingDraft,
  getMarketplaceListingById,
  listMarketplaceListings,
} from '@/lib/db';
import type { marketplaceListings } from '@/lib/schema';

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

const LISTING_FEE_AMOUNT = new BigNumber(0.001);
const DEFAULT_EXPIRY_HOURS = 24;

type MarketplaceStatus = typeof marketplaceListings.$inferSelect['status'];
const STATUS_WHITELIST = new Set<MarketplaceStatus>([
  'pending_fee',
  'active',
  'awaiting_payment',
  'sold',
  'expired',
]);

function sanitizeString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function sanitizeLargeText(value: unknown, maxLength = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function buildPhantomUrl(paymentUrl: string) {
  return `https://phantom.app/ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`;
}

function getExpiryDate() {
  return new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status');
  const buyerWallet = searchParams.get('buyerWallet');
  const includeContent = searchParams.get('includeContent') === '1';

  const statuses = statusParam
    ?.split(',')
    .map((status) => status.trim())
    .filter((status): status is MarketplaceStatus => STATUS_WHITELIST.has(status as MarketplaceStatus));

  const allListings = await listMarketplaceListings({
    status: statuses,
    buyerWallet: buyerWallet || undefined,
    limit: 50,
  });

  const listings = includeContent
    ? allListings
    : allListings.map(({ content, delivery_payload, ...rest }) => rest);

  return NextResponse.json({ listings });
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
    // Confirmation path
    const listing = await getMarketplaceListingById(listingId);
    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    if (
      listing.status === 'active' ||
      listing.status === 'awaiting_payment' ||
      listing.status === 'sold'
    ) {
      return NextResponse.json({ status: listing.status, listing });
    }

    if (listing.list_fee_reference !== reference) {
      return NextResponse.json({ error: 'Reference mismatch' }, { status: 409 });
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
        LISTING_FEE_AMOUNT,
        referenceKey
      );

      await activateMarketplaceListing(listing.id, signature, getExpiryDate());
      const updated = await getMarketplaceListingById(listing.id);

      return NextResponse.json(
        { status: 'active', listing: updated },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    } catch (err) {
      if (err instanceof FindReferenceError) {
        return NextResponse.json({ status: 'pending' }, { status: 402 });
      }
      console.error('Listing fee validation failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ 
        error: 'Validation failed',
        details: errorMessage 
      }, { status: 422 });
    }
  }

  // Creation path
  const agentId = sanitizeString((body as any).agentId, 64) || 'anonymous';
  const agentWallet = sanitizeString((body as any).agentWallet, 64);
  const title = sanitizeString((body as any).title, 120);
  const summary = sanitizeLargeText((body as any).summary, 1000);
  const content = sanitizeLargeText((body as any).content, 5000);

  if (!agentWallet) {
    return NextResponse.json({ error: 'agentWallet required' }, { status: 400 });
  }
  if (!title || !summary || !content) {
    return NextResponse.json({ error: 'Missing listing details' }, { status: 400 });
  }

  const listReference = Keypair.generate().publicKey.toBase58();

  const listing = await createMarketplaceListingDraft({
    agentId,
    agentWallet,
    title,
    summary,
    content,
    priceUsdc: '0.005',
    listFeeReference: listReference,
  });

  if (!listing) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const paymentFields: any = {
    recipient: new PublicKey(PROJECT_WALLET),
    amount: LISTING_FEE_AMOUNT,
    splToken: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    reference: new PublicKey(listReference),
    label: 'SolAI Marketplace Listing',
    message: `${title} listing fee`,
    memo: listing.id,
  };

  const paymentUrl = encodeURL(paymentFields).toString();

  return NextResponse.json(
    {
      listingId: listing.id,
      reference: listReference,
      amount: LISTING_FEE_AMOUNT.toFixed(3),
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

